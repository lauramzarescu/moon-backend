import express from 'express';
import * as QRCode from 'qrcode';
import {Organization, User} from '@prisma/client';
import {UAParser} from 'ua-parser-js';
import * as speakeasy from 'speakeasy';
import {GeneratedSecret} from 'speakeasy';
import crypto from 'crypto';
import {UserRepository} from '../../repositories/user/user.repository';
import {prisma} from '../../config/db.config';
import {OrganizationRepository} from '../../repositories/organization/organization.repository';
import {UserDeviceInfo} from './user.schema';

const TWO_FACTOR_EXPIRATION_DAYS = 21;

export class TwoFactorHelper {
    private static userRepository = new UserRepository(prisma);
    private static organizationRepository = new OrganizationRepository(prisma);

    static generateDeviceFingerprint(req: express.Request): string {
        const parser = new UAParser(req.headers['user-agent']);
        const browser = parser.getBrowser();
        const os = parser.getOS();
        const device = parser.getDevice();

        return `${browser.name}-${browser.version}-${os.name}-${os.version}-${device.vendor || ''}-${device.model || ''}`;
    }

    static async is2FAVerificationNeeded(userId: string, req: express.Request): Promise<boolean> {
        const user = await this.userRepository.getOne(userId);

        if (!user.twoFactorSecret || !user.twoFactorVerified) {
            return false;
        }

        const currentDeviceFingerprint = this.generateDeviceFingerprint(req);

        const userDevices: UserDeviceInfo[] = (user.verifiedDevices as unknown as UserDeviceInfo[]) || [];
        const deviceInfo = userDevices.find(d => d.fingerprint === currentDeviceFingerprint);

        if (!deviceInfo) {
            return true;
        }

        const lastVerified = new Date(deviceInfo.lastVerified);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - lastVerified.getTime()) / (1000 * 60 * 60 * 24));

        return diffDays >= TWO_FACTOR_EXPIRATION_DAYS;
    }

    static async is2FASetupRequired(userId: string): Promise<boolean> {
        const user = await this.userRepository.getOne(userId);
        const enforce2FA = (await this.organizationRepository.getOne(user.organizationId)).enforce2FA;

        return !user.twoFactorVerified && enforce2FA;
    }

    static async generateTwoFactorSetup(
        user: User,
        organization: Organization
    ): Promise<{
        qrCodeUrl: string;
        secret: GeneratedSecret;
    }> {
        // Generate a new secret
        const secret = speakeasy.generateSecret({
            name: `MOON - ${organization.name}:${user.email}`,
        });

        // Save the secret temporarily (not verified yet)
        await this.userRepository.update(user.id, {
            twoFactorSecret: secret.base32,
            twoFactorVerified: false,
        });

        // Generate QR code
        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url ?? '');

        return {qrCodeUrl, secret};
    }

    static async getAuthorizedDevices(userId: string): Promise<UserDeviceInfo[]> {
        const user = await this.userRepository.getOne(userId);
        return (user.verifiedDevices as unknown as UserDeviceInfo[]) || [];
    }

    static async removeAuthorizedDevice(userId: string, deviceId: string): Promise<void> {
        const user = await this.userRepository.getOne(userId);
        const userDevices: UserDeviceInfo[] = (user.verifiedDevices as unknown as UserDeviceInfo[]) || [];

        // Remove the device with the specified ID
        const updatedDevices = userDevices.filter(d => d.id !== deviceId);

        await this.userRepository.update(userId, {
            verifiedDevices: updatedDevices,
        });
    }

    static async updateVerifiedDevices(userId: string, req: express.Request): Promise<void> {
        const user = await this.userRepository.getOne(userId);
        const currentDeviceFingerprint = this.generateDeviceFingerprint(req);

        const userDevices: UserDeviceInfo[] = (user.verifiedDevices as unknown as UserDeviceInfo[]) || [];
        const deviceIndex = userDevices.findIndex(d => d.fingerprint === currentDeviceFingerprint);

        const deviceInfo = {
            id: crypto.randomUUID(),
            fingerprint: currentDeviceFingerprint,
            lastVerified: new Date().toISOString(),
            userAgent: req.headers['user-agent'],
        };

        if (deviceIndex >= 0) {
            userDevices[deviceIndex] = deviceInfo;
        } else {
            userDevices.push(deviceInfo);
        }

        await this.userRepository.update(userId, {
            verifiedDevices: userDevices,
        });

        return;
    }

    static async verifyTOTPCode(secret: string, code: string): Promise<boolean> {
        return speakeasy.totp.verify({
            secret: secret,
            encoding: 'base32',
            token: code,
        });
    }

    static generateResetToken(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    static generateResetTokenExpiry(): Date {
        return new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    }

    static async reset2FA(userId: string): Promise<void> {
        await this.userRepository.update(userId, {
            twoFactorSecret: null,
            twoFactorVerified: false,
            verifiedDevices: [],
        });
    }

    static async reset2FAWithToken(userId: string): Promise<void> {
        await this.userRepository.update(userId, {
            twoFactorSecret: null,
            twoFactorVerified: false,
            verifiedDevices: [],
            twoFactorResetToken: null,
            twoFactorResetTokenExpiry: null,
        });
    }

    static async findUserByResetToken(token: string): Promise<User | null> {
        return await this.userRepository.findOneWhere({
            twoFactorResetToken: token,
        });
    }

    static async saveResetToken(userId: string, resetToken: string, resetTokenExpiry: Date): Promise<void> {
        await this.userRepository.update(userId, {
            twoFactorResetToken: resetToken,
            twoFactorResetTokenExpiry: resetTokenExpiry,
        });
    }

    static isResetTokenValid(user: User): boolean {
        return !!(user.twoFactorResetTokenExpiry && user.twoFactorResetTokenExpiry >= new Date());
    }
}
