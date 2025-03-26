import {z} from 'zod';
import {LoginType, UserRole} from '@prisma/client';

export const userDeviceInfoSchema = z.object({
    fingerprint: z.string(),
    lastVerified: z.string(),
    userAgent: z.string().optional()
})

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
    verifiedDevices: z.array(userDeviceInfoSchema).optional()
});

export const userDetailsResponseSchema = userSchema
    .omit({
        lastLogin: true,
        password: true,
        nameID: true,
        nameIDFormat: true,
        sessionIndex: true,
        twoFactorSecret: true,
    })

export const userCreateSchema = userSchema
    .omit({
        loginType: true,
        nameID: true,
        nameIDFormat: true,
        lastLogin: true,
        sessionIndex: true,
        twoFactorSecret: true,
        twoFactorVerified: true,
    })
    .partial({
        organizationId: true,
    })

export const userUpdateSchema = userCreateSchema;
export const twoFactorVerifySchema = z.object({
    code: z.string().min(6).max(6)
});

export const twoFactorDisableSchema = twoFactorVerifySchema
export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters")
});

export const changePasswordWith2FASchema = z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
    code: z.string().length(6, "2FA code must be 6 digits")
});

export type UserInput = z.infer<typeof userSchema>;
export type TwoFactorVerifyInput = z.infer<typeof twoFactorVerifySchema>;
export type TwoFactorDisableInput = z.infer<typeof twoFactorDisableSchema>;
export type UserDeviceInfo = z.infer<typeof userDeviceInfoSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;