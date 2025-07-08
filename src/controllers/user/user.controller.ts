import express from 'express';
import {UserRepository} from '../../repositories/user/user.repository';
import {
    userCreateByInvitationSchema,
    userCreateSchema,
    userDetailsResponseSchema,
    userExportSchema,
    usersImportRequestSchema,
    userUpdateSchema,
} from './user.schema';
import {AuthService} from '../../services/auth.service';
import {UserHelper} from './helper';
import {PaginationHandler} from '../../utils/pagination.util';
import {prisma} from '../../config/db.config';
import bcrypt from 'bcrypt';
import {User} from '@prisma/client';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import {EmailService} from '../../services/email.service';
import crypto from 'crypto';
import logger from '../../config/logger';
import {AuditLogRepository} from '../../repositories/audit-log/audit-log.repository';
import {TwoFactorHelper} from './two-factor.helper';

export class UserController {
    static userRepository = new UserRepository(prisma);
    static auditRepository = new AuditLogRepository(prisma);
    static auditHelper = new AuditLogHelper();
    static emailService = new EmailService();

    static getUserDetails = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;

            const me = userDetailsResponseSchema.parse(user);
            me.name = user.name || user.nameID || 'N/A';

            res.json(me);
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static getAll = async (req: express.Request, res: express.Response) => {
        try {
            const users = await this.userRepository.getAll({role: 'asc'});
            res.json(users);
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static getAllPaginated = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const filters = PaginationHandler.translateFilters(req.query, 'user');

            const paginatedUsers = await UserHelper.getAuthorizedPaginated(token.userId, {
                page: Number(req.query.page) || 1,
                limit: Number(req.query.limit) || 50,
                filters,
                orderBy: String(req.query.orderBy || 'createdAt'),
                order: (req.query.order as 'asc' | 'desc') || 'desc',
            });

            res.json(paginatedUsers);
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static getOne = async (req: express.Request, res: express.Response) => {
        try {
            const user = await this.userRepository.getOne(req.params.id);
            res.json(user);
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static create = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            const validatedData = userCreateSchema.parse(req.body);

            validatedData.organizationId = requesterUser.organizationId;
            validatedData.password = await bcrypt.hash(validatedData.password as string, 10);

            const isDuplicate = await this.userRepository.findOneWhere({
                email: validatedData.email.toLowerCase(),
            });

            if (isDuplicate) {
                res.status(400).json({message: 'Email already exists'});
                return;
            }

            const user = await this.userRepository.create(validatedData);

            res.status(201).json(user);

            await this.auditHelper.create({
                userId: requesterUser?.id || '-',
                organizationId: requesterUser?.organizationId || '-',
                action: AuditLogEnum.USER_CREATED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: requesterUser?.email || '-',
                        description: `User ${user.email} created`,
                        objectNew: user,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static createByInvitation = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            const validatedData = userCreateByInvitationSchema.parse(req.body);

            validatedData.organizationId = requesterUser.organizationId;

            const isDuplicate = await this.userRepository.findOneWhere({
                email: validatedData.email.toLowerCase(),
            });

            if (isDuplicate) {
                res.status(400).json({message: 'Email already exists'});
                return;
            }

            const user = await this.userRepository.create(validatedData);

            // Generate reset token
            const resetToken = crypto.randomBytes(32).toString('hex');
            const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

            await this.userRepository.update(user.id, {
                resetToken,
                resetTokenExpiry,
            });

            await this.emailService.sendInvitationEmail(user.email, requesterUser.email, resetToken);

            res.status(201).json(user);

            await this.auditHelper.create({
                userId: requesterUser?.id || '-',
                organizationId: requesterUser?.organizationId || '-',
                action: AuditLogEnum.USER_CREATED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: requesterUser?.email || '-',
                        description: `User ${user.email} created`,
                        objectNew: user,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static update = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            const validatedData = userUpdateSchema.parse(req.body);
            const user = await this.userRepository.update(req.params.id, validatedData);

            res.json(user);

            await this.auditHelper.create({
                userId: requesterUser?.id || '-',
                organizationId: requesterUser?.organizationId || '-',
                action: AuditLogEnum.USER_UPDATED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: requesterUser?.email || '-',
                        description: `User ${user.email} updated`,
                        objectOld: requesterUser,
                        objectNew: user,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static delete = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            const userToDelete = await this.userRepository.getOne(req.params.id);

            // Prevent self-deletion
            if (requesterUser.id === req.params.id) {
                res.status(400).json({message: 'You cannot delete your own account'});
                return;
            }

            // Ensure user belongs to same organization
            if (userToDelete.organizationId !== requesterUser.organizationId) {
                res.status(403).json({message: 'You can only delete users from your organization'});
                return;
            }

            await this.auditRepository.deleteMany({userId: userToDelete.id});
            const deletedUser = await this.userRepository.delete(req.params.id);

            res.json({
                success: true,
                message: 'User deleted successfully',
                user: {
                    id: deletedUser.id,
                    email: deletedUser.email,
                    name: deletedUser.name,
                },
            });

            await this.auditHelper.create({
                userId: requesterUser?.id || '-',
                organizationId: requesterUser?.organizationId || '-',
                action: AuditLogEnum.USER_DELETED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: requesterUser?.email || '-',
                        description: `User ${deletedUser.email} deleted`,
                        objectOld: deletedUser,
                    },
                },
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };

    static getAuthorizedDevices = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;

            res.status(200).json(requesterUser.verifiedDevices);
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };

    static removeAuthorizedDevice = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            const deviceId = req.params.id;

            await TwoFactorHelper.removeAuthorizedDevice(requesterUser.id, deviceId);

            res.status(200).json({success: true, message: 'Device removed successfully'});
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };

    static exportUsers = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;

            // Get all users from the same organization
            const users = await this.userRepository.findMany({
                organizationId: requesterUser.organizationId,
            });

            // Transform users to export format (excluding sensitive data)
            const exportData = users.map(user => {
                return userExportSchema.parse({
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    loginType: user.loginType,
                    twoFactorVerified: user.twoFactorVerified,
                    createdAt: user.createdAt,
                    updatedAt: user.updatedAt,
                });
            });

            // Set headers for file download
            res.setHeader('Content-Type', 'application/json');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="users-export-${new Date().toISOString().split('T')[0]}.json"`
            );

            res.json({
                exportDate: new Date().toISOString(),
                organizationId: requesterUser.organizationId,
                totalUsers: exportData.length,
                users: exportData,
            });

            await this.auditHelper.create({
                userId: requesterUser?.id || '-',
                organizationId: requesterUser?.organizationId || '-',
                action: AuditLogEnum.USER_EXPORTED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: requesterUser?.email || '-',
                        description: `Exported ${exportData.length} users`,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static importUsers = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            let validatedData;

            // Check if it's a file upload, base64 file object, or JSON body
            if ((req as any).file) {
                // Handle multer file upload
                try {
                    const file = (req as any).file as Express.Multer.File;
                    const fileContent = file.buffer.toString('utf8');
                    const parsedData = JSON.parse(fileContent);

                    // Validate the parsed JSON structure
                    validatedData = usersImportRequestSchema.parse(parsedData);
                } catch (parseError: any) {
                    res.status(400).json({
                        message: 'Invalid JSON file format',
                        error: parseError.message,
                    });
                    return;
                }
            } else if (req.body.file) {
                // Handle base64 file object from frontend
                try {
                    const base64Data = req.body.file;
                    const decodedData = Buffer.from(base64Data, 'base64').toString('utf8');
                    const parsedData = JSON.parse(decodedData);

                    // If the decoded data is a single user object, wrap it in an array
                    let usersData;
                    if (Array.isArray(parsedData)) {
                        usersData = {users: parsedData};
                    } else if (parsedData.users) {
                        usersData = parsedData;
                    } else {
                        // Single user object
                        usersData = {users: [parsedData]};
                    }

                    // Validate the parsed JSON structure
                    validatedData = usersImportRequestSchema.parse(usersData);
                } catch (parseError: any) {
                    res.status(400).json({
                        message: 'Invalid base64 file data format',
                        error: parseError.message,
                    });
                    return;
                }
            } else {
                // Handle direct JSON body - support both array and object formats
                let bodyData = req.body;

                // If body is an array, wrap it in the expected format
                if (Array.isArray(bodyData)) {
                    bodyData = {users: bodyData};
                }

                validatedData = usersImportRequestSchema.parse(bodyData);
            }

            const results = {
                successful: [] as any[],
                failed: [] as any[],
                skipped: [] as any[],
            };

            for (const userData of validatedData.users) {
                try {
                    // Check if user already exists
                    const existingUser = await this.userRepository.findOneWhere({
                        email: userData.email.toLowerCase(),
                    });

                    if (existingUser) {
                        results.skipped.push({
                            email: userData.email,
                            reason: 'Email already exists',
                        });
                        continue;
                    }

                    // Create user without password
                    const newUser = await this.userRepository.create({
                        name: userData.name,
                        email: userData.email.toLowerCase(),
                        role: userData.role,
                        organizationId: requesterUser.organizationId,
                        // No password set - user will need to set it via invitation
                    });

                    // Generate reset token for password setup
                    const resetToken = crypto.randomBytes(32).toString('hex');
                    const resetTokenExpiry = new Date(Date.now() + 7 * 24 * 3600000); // 7 days for imports

                    await this.userRepository.update(newUser.id, {
                        resetToken,
                        resetTokenExpiry,
                    });

                    // Send invitation email
                    await this.emailService.sendInvitationEmail(newUser.email, requesterUser.email, resetToken);

                    results.successful.push({
                        email: newUser.email,
                        name: newUser.name,
                        role: newUser.role,
                        id: newUser.id,
                    });
                } catch (userError: any) {
                    results.failed.push({
                        email: userData.email,
                        reason: userError.message,
                    });
                }
            }

            res.status(201).json({
                message: 'User import completed',
                summary: {
                    total: validatedData.users.length,
                    successful: results.successful.length,
                    failed: results.failed.length,
                    skipped: results.skipped.length,
                },
                results,
            });

            await this.auditHelper.create({
                userId: requesterUser?.id || '-',
                organizationId: requesterUser?.organizationId || '-',
                action: AuditLogEnum.USER_IMPORTED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: requesterUser?.email || '-',
                        description: `Imported users: ${results.successful.length} successful, ${results.failed.length} failed, ${results.skipped.length} skipped`,
                        importMethod: (req as any).file
                            ? 'multer-file'
                            : req.body.file
                              ? 'base64-file'
                              : req.body.base64Data
                                ? 'base64'
                                : 'json',
                        filename: req.body.filename || 'unknown',
                        mimetype: req.body.mimetype || 'unknown',
                        importSummary: {
                            total: validatedData.users.length,
                            successful: results.successful.length,
                            failed: results.failed.length,
                            skipped: results.skipped.length,
                        },
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };
}
