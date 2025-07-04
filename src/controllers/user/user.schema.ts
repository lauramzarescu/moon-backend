import {z} from 'zod';
import {LoginType, UserRole} from '@prisma/client';

export const userDeviceInfoSchema = z.object({
    fingerprint: z.string(),
    lastVerified: z.string(),
    userAgent: z.string().optional(),
});

export const userSchema = z.object({
    name: z.string().optional().nullable(),
    email: z.string().email(),
    organizationId: z.string(),
    password: z.string().optional().nullable(),
    loginType: z.nativeEnum(LoginType).default(LoginType.local),
    role: z.nativeEnum(UserRole).default(UserRole.user),
    nameID: z.string().optional().nullable(),
    nameIDFormat: z.string().optional().nullable(),
    lastLogin: z.date().optional().nullable(),
    sessionIndex: z.string().optional().nullable(),
    twoFactorSecret: z.string().optional().nullable(),
    twoFactorVerified: z.boolean().default(false),
    verifiedDevices: z.array(userDeviceInfoSchema).optional(),
    resetToken: z.string().optional().nullable(),
    resetTokenExpiry: z.date().optional().nullable(),
    twoFactorResetToken: z.string().optional().nullable(),
    twoFactorResetTokenExpiry: z.date().optional().nullable(),
});

export const userDetailsResponseSchema = userSchema.omit({
    lastLogin: true,
    password: true,
    nameID: true,
    nameIDFormat: true,
    sessionIndex: true,
    twoFactorSecret: true,
    resetToken: true,
    resetTokenExpiry: true,
    twoFactorResetToken: true,
    twoFactorResetTokenExpiry: true,
});

export const userCreateSchema = userSchema
    .omit({
        loginType: true,
        nameID: true,
        nameIDFormat: true,
        lastLogin: true,
        sessionIndex: true,
        twoFactorSecret: true,
        twoFactorVerified: true,
        resetToken: true,
        resetTokenExpiry: true,
        twoFactorResetToken: true,
        twoFactorResetTokenExpiry: true,
    })
    .partial({
        organizationId: true,
    });

export const userCreateByInvitationSchema = userCreateSchema.omit({
    password: true,
});

export const userUpdateSchema = userCreateSchema;

export const userImportSchema = z.object({
    name: z.string().optional().nullable(),
    email: z.string().email(),
    role: z.nativeEnum(UserRole).default(UserRole.user),
});

export const userExportSchema = z.object({
    name: z.string().optional().nullable(),
    email: z.string().email(),
    role: z.nativeEnum(UserRole),
    loginType: z.nativeEnum(LoginType),
    twoFactorVerified: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const usersImportRequestSchema = z.object({
    users: z.array(userImportSchema).min(1, 'At least one user is required'),
});

// Password schemas
export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const changePasswordWith2FASchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
    code: z.string().length(6, '2FA code must be 6 digits'),
});

export const forgotPasswordSchema = z.object({
    email: z.string().email('Valid email is required'),
});

export const resetPasswordSchema = z.object({
    token: z.string().min(1, 'Reset token is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export const adminResetPasswordSchema = z.object({
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

// 2FA schemas
export const twoFactorVerifySchema = z.object({
    code: z.string().min(6).max(6),
});

export const twoFactorDisableSchema = twoFactorVerifySchema;

export const reset2FASchema = z.object({
    email: z.string().email('Valid email is required'),
});

// Type exports
export type UserInput = z.infer<typeof userSchema>;
export type TwoFactorVerifyInput = z.infer<typeof twoFactorVerifySchema>;
export type TwoFactorDisableInput = z.infer<typeof twoFactorDisableSchema>;
export type UserDeviceInfo = z.infer<typeof userDeviceInfoSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserCreateByInvitationInput = z.infer<typeof userCreateByInvitationSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;
export type Reset2FAInput = z.infer<typeof reset2FASchema>;
export type UserImportInput = z.infer<typeof userImportSchema>;
export type UserExportInput = z.infer<typeof userExportSchema>;
export type UsersImportRequestInput = z.infer<typeof usersImportRequestSchema>;
