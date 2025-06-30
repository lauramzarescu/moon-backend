import express from 'express';
import {UserRepository} from '../../repositories/user/user.repository';
import {
    changePasswordSchema,
    changePasswordWith2FASchema,
    forgotPasswordSchema,
    resetPasswordSchema,
} from './user.schema';
import {prisma} from '../../config/db.config';
import bcrypt from 'bcrypt';
import {LoginType, User} from '@prisma/client';
import * as speakeasy from 'speakeasy';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import {EmailService} from '../../services/email.service';
import crypto from 'crypto';

export class PasswordController {
    static userRepository = new UserRepository(prisma);
    static auditHelper = new AuditLogHelper();
    static emailService = new EmailService();

    static changePassword = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;

            if (!user.password || user.loginType !== LoginType.local) {
                res.status(400).json({message: 'Password change is only available for local accounts'});
                return;
            }

            if (user.twoFactorSecret && user.twoFactorVerified) {
                res.status(400).json({message: 'You must verify your 2FA before changing password.'});
                return;
            }

            const validatedData = changePasswordSchema.parse(req.body);

            const isPasswordValid = await bcrypt.compare(validatedData.currentPassword, user.password);
            if (!isPasswordValid) {
                res.status(400).json({message: 'Current password is incorrect'});
                return;
            }

            const hashedPassword = await bcrypt.hash(validatedData.newPassword, 10);

            await this.userRepository.update(user.id, {
                password: hashedPassword,
            });

            res.json({success: true, message: 'Password changed successfully'});

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.USER_PASSWORD_CHANGED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `User ${user.email} changed password`,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static changePasswordWith2FA = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;

            if (!user.password || user.loginType !== LoginType.local) {
                res.status(400).json({message: 'Password change is only available for local accounts'});
                return;
            }

            if (!user.twoFactorSecret || !user.twoFactorVerified) {
                res.status(400).json({message: '2FA is not enabled or verified for this account'});
                return;
            }

            const validatedData = changePasswordWith2FASchema.parse(req.body);
            const isPasswordValid = await bcrypt.compare(validatedData.currentPassword, user.password);

            if (!isPasswordValid) {
                res.status(400).json({message: 'Current password is incorrect'});
                return;
            }

            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: validatedData.code,
            });

            if (!verified) {
                res.status(400).json({message: 'Invalid 2FA verification code'});
                return;
            }

            const hashedPassword = await bcrypt.hash(validatedData.newPassword, 10);

            await this.userRepository.update(user.id, {
                password: hashedPassword,
                verifiedDevices: [],
            });

            res.json({success: true, message: 'Password changed successfully with 2FA verification'});

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.USER_PASSWORD_CHANGED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `User ${user.email} changed password with 2FA`,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static forgotPassword = async (req: express.Request, res: express.Response) => {
        try {
            const validatedData = forgotPasswordSchema.parse(req.body);
            const user = await this.userRepository.findOneWhere({
                email: validatedData.email.toLowerCase(),
            });

            // Always return success to prevent email enumeration
            if (!user) {
                res.json({success: true, message: 'If the email exists, a password reset link will be sent'});
                return;
            }

            if (user.loginType !== LoginType.local) {
                res.json({success: true, message: 'If the email exists, a password reset link will be sent'});
                return;
            }

            // Generate reset token
            const resetToken = crypto.randomBytes(32).toString('hex');
            const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

            await this.userRepository.update(user.id, {
                resetToken,
                resetTokenExpiry,
            });

            // Mock email sending
            await this.emailService.sendPasswordResetEmail(user.email, resetToken);

            res.json({success: true, message: 'If the email exists, a password reset link will be sent'});

            await this.auditHelper.create({
                userId: user.id,
                organizationId: user.organizationId,
                action: AuditLogEnum.USER_PASSWORD_RESET_REQUESTED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user.email,
                        description: `Password reset requested for ${user.email}`,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static resetPassword = async (req: express.Request, res: express.Response) => {
        try {
            const validatedData = resetPasswordSchema.parse(req.body);

            const user = await this.userRepository.findOneWhere({
                resetToken: validatedData.token,
            });

            if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
                res.status(400).json({message: 'Invalid or expired reset token'});
                return;
            }

            const hashedPassword = await bcrypt.hash(validatedData.newPassword, 10);

            await this.userRepository.update(user.id, {
                password: hashedPassword,
                resetToken: null,
                resetTokenExpiry: null,
                // Clear 2FA devices on password reset for security
                verifiedDevices: [],
            });

            res.json({success: true, message: 'Password reset successfully'});

            await this.auditHelper.create({
                userId: user.id,
                organizationId: user.organizationId,
                action: AuditLogEnum.USER_PASSWORD_RESET,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user.email,
                        description: `Password reset completed for ${user.email}`,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static adminResetPassword = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            const targetUser = await this.userRepository.getOne(req.params.id);

            // Ensure target user belongs to same organization
            if (targetUser.organizationId !== requesterUser.organizationId) {
                res.status(403).json({message: 'You can only reset passwords for users in your organization'});
                return;
            }

            // Prevent admin from resetting their own password this way
            if (targetUser.id === requesterUser.id) {
                res.status(400).json({message: 'Use the regular password change endpoint for your own password'});
                return;
            }

            if (targetUser.loginType !== LoginType.local) {
                res.status(400).json({message: 'Password reset is only available for local accounts'});
                return;
            }

            // Generate reset token
            const resetToken = crypto.randomBytes(32).toString('hex');
            const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

            await this.userRepository.update(targetUser.id, {
                resetToken,
                resetTokenExpiry,
                password: null,
            });

            await this.emailService.sendPasswordResetEmail(targetUser.email, resetToken);

            res.json({
                success: true,
                message: `Password reset email sent successfully for user ${targetUser.email}`,
            });

            await this.auditHelper.create({
                userId: requesterUser.id,
                organizationId: requesterUser.organizationId,
                action: AuditLogEnum.USER_PASSWORD_ADMIN_RESET,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: requesterUser.email,
                        description: `Admin ${requesterUser.email} reset password for ${targetUser.email}`,
                        targetUserId: targetUser.id,
                        targetUserEmail: targetUser.email,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };
}
