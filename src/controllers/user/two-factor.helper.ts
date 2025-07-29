import * as express from 'express';
import * as QRCode from 'qrcode';
import {AuthType, Organization, TwoFactorMethod, User} from '@prisma/client';
import {UAParser} from 'ua-parser-js';
import * as speakeasy from 'speakeasy';
import {GeneratedSecret} from 'speakeasy';
import * as crypto from 'crypto';
import {UserRepository} from '../../repositories/user/user.repository';
import {prisma} from '../../config/db.config';
import {OrganizationRepository} from '../../repositories/organization/organization.repository';
import {YubikeyRepository} from '../../repositories/yubikey/yubikey.repository';
import {UserDeviceInfo} from './user.schema';
import type {
    AuthenticationResponseJSON,
    GenerateAuthenticationOptionsOpts,
    GenerateRegistrationOptionsOpts,
    RegistrationResponseJSON,
    VerifyAuthenticationResponseOpts,
    VerifyRegistrationResponseOpts,
} from '@simplewebauthn/server';
import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
} from '@simplewebauthn/server';

const yub = require('yub');
const TWO_FACTOR_EXPIRATION_DAYS = 21;

// WebAuthn configuration
const RP_NAME = 'MOON';
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const ORIGIN = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000';

// Temporary challenge storage (in production, use Redis or database)
const challengeStore = new Map<string, {challenge: string; userId: string; timestamp: number}>();

// Clean up expired challenges every 5 minutes
setInterval(
    () => {
        const now = Date.now();
        const fiveMinutesAgo = now - 5 * 60 * 1000;
        for (const [key, value] of challengeStore.entries()) {
            if (value.timestamp < fiveMinutesAgo) {
                challengeStore.delete(key);
            }
        }
    },
    5 * 60 * 1000
);

export class TwoFactorHelper {
    private static userRepository = new UserRepository(prisma);
    private static organizationRepository = new OrganizationRepository(prisma);
    static yubikeyRepository = new YubikeyRepository(prisma);

    static generateDeviceFingerprint(req: express.Request): string {
        const parser = new UAParser(req.headers['user-agent']);
        const browser = parser.getBrowser();
        const os = parser.getOS();
        const device = parser.getDevice();

        return `${browser.name}-${browser.version}-${os.name}-${os.version}-${device.vendor || ''}-${device.model || ''}`;
    }

    static async is2FAVerificationNeeded(userId: string, req: express.Request): Promise<boolean> {
        const user = await this.userRepository.getOne(userId);
        const yubikeys = await this.getUserYubikeys(userId);
        const hasValidTOTP = user.twoFactorSecret && user.twoFactorVerified;
        const hasValidYubikey = yubikeys.length > 0;

        if (!hasValidTOTP && !hasValidYubikey) {
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

        return (!user.twoFactorVerified || !user.twoFactorSecret) && enforce2FA;
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

    static async reset2FAWithToken(userId: string): Promise<void> {
        await this.yubikeyRepository.deleteAllByUserId(userId);

        await this.userRepository.update(userId, {
            twoFactorSecret: null,
            twoFactorVerified: false,
            twoFactorMethod: TwoFactorMethod.TOTP,
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

    static async verifyYubikeyOTP(otp: string): Promise<{valid: boolean; identity?: string; error?: string}> {
        const clientId = process.env.YUBICO_CLIENT_ID;
        const secretKey = process.env.YUBICO_SECRET_KEY;

        if (!clientId || !secretKey) {
            return {valid: false, error: 'YubiKey validation not configured'};
        }

        yub.init(clientId, secretKey);

        return new Promise(resolve => {
            yub.verify(otp, (err: any, data: any) => {
                console.log('YubiKey verification result:', data);
                if (err) {
                    resolve({valid: false, error: err.message});
                    return;
                }

                if (data && data.valid && data.status === 'OK') {
                    resolve({valid: true, identity: data.identity});
                } else {
                    resolve({valid: false, error: data?.status || 'Invalid OTP'});
                }
            });
        });
    }

    static async addYubikeyToUser(userId: string, publicId: string, nickname?: string): Promise<string> {
        const existingYubikey = await this.yubikeyRepository.findByPublicId(publicId);

        if (existingYubikey) {
            throw new Error('This YubiKey is already registered');
        }

        const yubikeyRecord = await this.yubikeyRepository.create({
            publicId: publicId,
            nickname: nickname,
            userId: userId,
        });

        await this.userRepository.update(userId, {
            twoFactorVerified: true,
        });

        return yubikeyRecord.id;
    }

    static async removeYubikeyFromUser(userId: string, yubikeyId: string): Promise<void> {
        await this.yubikeyRepository.deleteById(yubikeyId, userId);
    }

    static async isYubikeyOwnedByUser(userId: string, yubikeyId: string): Promise<boolean> {
        const yubikey = await this.yubikeyRepository.findByIdAndUserId(yubikeyId, userId);
        return !!yubikey;
    }

    static async isYubikeyRegistered(userId: string, publicId: string): Promise<boolean> {
        const yubikey = await this.yubikeyRepository.findByUserIdAndPublicId(userId, publicId);
        // Only consider OTP YubiKeys for OTP verification
        return !!yubikey && (yubikey.authType === AuthType.OTP || !yubikey.authType);
    }

    static async getUserYubikeys(userId: string): Promise<any[]> {
        const yubikeys = await this.yubikeyRepository.findByUserId(userId);

        return yubikeys.map(yubikey => ({
            id: yubikey.id,
            publicId: yubikey.publicId,
            nickname: yubikey.nickname,
            createdAt: yubikey.createdAt.toISOString(),
            lastUsed: yubikey.lastUsed?.toISOString(),
            authType: yubikey.authType || AuthType.OTP,
            credentialId: yubikey.credentialId,
        }));
    }

    static async updateYubikeyLastUsed(userId: string, publicId: string): Promise<void> {
        await this.yubikeyRepository.updateLastUsed(userId, publicId);
    }

    static async updateYubikeyNickname(userId: string, yubikeyId: string, nickname?: string): Promise<void> {
        await this.yubikeyRepository.updateNickname(yubikeyId, userId, nickname);
    }

    static async setTwoFactorMethod(userId: string, method: TwoFactorMethod): Promise<void> {
        await this.userRepository.update(userId, {
            twoFactorMethod: method,
        });
    }

    static async getTwoFactorMethod(userId: string): Promise<TwoFactorMethod | null> {
        const user = await this.userRepository.getOne(userId);
        return user.twoFactorMethod || TwoFactorMethod.TOTP;
    }

    static async getAvailableMethods(userId: string): Promise<TwoFactorMethod[]> {
        const user = await this.userRepository.getOne(userId);
        const yubikeys = await this.getUserYubikeys(userId);

        const availableMethods: TwoFactorMethod[] = [];
        const hasTotp = !!user.twoFactorSecret; // Mobile auth (TOTP)
        const hasWebAuthn = yubikeys.some(y => y.authType === AuthType.WEBAUTHN);
        const hasOtpYubikey = yubikeys.some(y => y.authType === AuthType.OTP);

        // Security hierarchy: Mobile auth = WebAuthn > OTP YubiKey

        // 1. If mobile auth (TOTP) is available, always enable it
        if (hasTotp) {
            availableMethods.push(TwoFactorMethod.TOTP);
        }

        // 2. If WebAuthn is available, always enable it (same priority as mobile auth)
        if (hasWebAuthn) {
            availableMethods.push(TwoFactorMethod.YUBIKEY);
        }

        // 3. If OTP YubiKey is available, enable it only if WebAuthn is not available
        if (hasOtpYubikey && !hasWebAuthn) {
            availableMethods.push(TwoFactorMethod.YUBIKEY);
        }

        // If user has multiple high-security methods available (mobile auth + WebAuthn), they can use ANY
        if (availableMethods.length > 1) {
            availableMethods.push(TwoFactorMethod.ANY);
        }

        return availableMethods;
    }

    static async autoUpdateTwoFactorMethod(userId: string): Promise<void> {
        const user = await this.userRepository.getOne(userId);
        const yubikeys = await this.getUserYubikeys(userId);
        const currentMethod = user.twoFactorMethod;

        const hasTotp = !!user.twoFactorSecret; // Mobile auth
        const hasWebAuthn = yubikeys.some(y => y.authType === AuthType.WEBAUTHN);
        const hasOtpYubikey = yubikeys.some(y => y.authType === AuthType.OTP);

        // Security hierarchy: Mobile auth = WebAuthn > OTP YubiKey

        if (hasTotp && hasWebAuthn) {
            // Both mobile auth and WebAuthn available - allow ANY (both are high security)
            await this.setTwoFactorMethod(userId, TwoFactorMethod.ANY);
        } else if (hasTotp && hasOtpYubikey && !hasWebAuthn) {
            // Mobile auth + OTP YubiKey available - allow ANY
            await this.setTwoFactorMethod(userId, TwoFactorMethod.ANY);
        } else if (hasTotp && !hasWebAuthn && !hasOtpYubikey) {
            // Only mobile auth available
            await this.setTwoFactorMethod(userId, TwoFactorMethod.TOTP);
        } else if (hasWebAuthn && !hasTotp && !hasOtpYubikey) {
            // Only WebAuthn available
            await this.setTwoFactorMethod(userId, TwoFactorMethod.YUBIKEY);
        } else if (hasOtpYubikey && !hasTotp && !hasWebAuthn) {
            // Only OTP YubiKey available
            await this.setTwoFactorMethod(userId, TwoFactorMethod.YUBIKEY);
        } else if (hasWebAuthn && hasOtpYubikey) {
            // WebAuthn + OTP YubiKey - prioritize WebAuthn
            await this.setTwoFactorMethod(userId, TwoFactorMethod.YUBIKEY);
        } else {
            // No methods available - reset to default
            await this.setTwoFactorMethod(userId, TwoFactorMethod.TOTP);
        }
    }

    static async verify2FACode(user: User, code: string, method?: TwoFactorMethod): Promise<boolean> {
        const yubikeys = await this.getUserYubikeys(user.id);
        const hasTotp = !!user.twoFactorSecret;
        const hasWebAuthn = yubikeys.some(y => y.authType === AuthType.WEBAUTHN);
        const hasOtpYubikey = yubikeys.some(y => y.authType === AuthType.OTP);

        // Security hierarchy: Mobile auth = WebAuthn > OTP YubiKey
        // Block OTP YubiKey if WebAuthn is available
        const webAuthnAvailable = hasWebAuthn;

        const twoFactorMethod = method || user.twoFactorMethod || TwoFactorMethod.TOTP;

        switch (twoFactorMethod) {
            case TwoFactorMethod.TOTP:
                if (!user.twoFactorSecret) return false;
                // Mobile auth is always allowed (high security)
                return await this.verifyTOTPCode(user.twoFactorSecret, code);

            case TwoFactorMethod.YUBIKEY:
                // Check if this is WebAuthn or OTP YubiKey verification
                if (hasWebAuthn) {
                    // WebAuthn verification should be handled separately via WebAuthn endpoints
                    // This method is for OTP verification only
                    return false;
                }

                // For OTP YubiKey: only allow if WebAuthn is not available
                if (webAuthnAvailable && hasOtpYubikey) {
                    return false; // Block OTP when WebAuthn is available
                }

                const yubikeyResult = await this.verifyYubikeyOTP(code);
                if (!yubikeyResult.valid || !yubikeyResult.identity) return false;

                const isRegistered = await this.isYubikeyRegistered(user.id, yubikeyResult.identity);
                if (isRegistered) {
                    await this.updateYubikeyLastUsed(user.id, yubikeyResult.identity);
                }
                return isRegistered;

            case TwoFactorMethod.ANY:
                // For ANY method, auto-detect but respect security hierarchy
                return await this.verifyAnyAvailableMethod(user, code);

            default:
                return false;
        }
    }

    static async verifyAnyAvailableMethod(user: User, code: string): Promise<boolean> {
        const yubikeys = await this.getUserYubikeys(user.id);
        const hasTotp = !!user.twoFactorSecret;
        const hasWebAuthn = yubikeys.some(y => y.authType === AuthType.WEBAUTHN);
        const hasOtpYubikey = yubikeys.some(y => y.authType === AuthType.OTP);

        // Security hierarchy: Mobile auth = WebAuthn > OTP YubiKey
        const webAuthnAvailable = hasWebAuthn;

        // Try mobile auth (TOTP) first if it looks like a 6-digit code and user has TOTP set up
        if (code.length === 6 && /^\d{6}$/.test(code) && hasTotp && user.twoFactorSecret) {
            const totpValid = await this.verifyTOTPCode(user.twoFactorSecret, code);
            if (totpValid) return true;
        }

        // WebAuthn verification should be handled separately via WebAuthn endpoints
        // This method doesn't handle WebAuthn

        // Try YubiKey OTP only if WebAuthn is not available
        if (hasOtpYubikey && !webAuthnAvailable && code.length >= 32 && /^[cbdefghijklnrtuv]{32,48}$/.test(code)) {
            const yubikeyResult = await this.verifyYubikeyOTP(code);

            if (yubikeyResult.valid && yubikeyResult.identity) {
                const isRegistered = await this.isYubikeyRegistered(user.id, yubikeyResult.identity);

                if (isRegistered) {
                    await this.updateYubikeyLastUsed(user.id, yubikeyResult.identity);
                    return true;
                }
            }
        }

        return false;
    }

    static async reset2FA(userId: string): Promise<void> {
        await this.yubikeyRepository.deleteAllByUserId(userId);

        await this.userRepository.update(userId, {
            twoFactorSecret: null,
            twoFactorVerified: false,
            twoFactorMethod: TwoFactorMethod.TOTP,
            verifiedDevices: [],
        });
    }

    // Challenge management methods
    static storeChallenge(challengeId: string, challenge: string, userId: string): void {
        challengeStore.set(challengeId, {
            challenge,
            userId,
            timestamp: Date.now(),
        });
    }

    static getChallenge(challengeId: string): {challenge: string; userId: string} | null {
        const stored = challengeStore.get(challengeId);
        if (!stored) return null;

        // Check if challenge is expired (5 minutes)
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        if (stored.timestamp < fiveMinutesAgo) {
            challengeStore.delete(challengeId);
            return null;
        }

        return {challenge: stored.challenge, userId: stored.userId};
    }

    static removeChallenge(challengeId: string): void {
        challengeStore.delete(challengeId);
    }

    static generateChallengeId(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    // WebAuthn methods
    static async generateWebAuthnRegistrationOptions(
        userId: string,
        userName: string
    ): Promise<{
        options: any;
        challengeId: string;
    }> {
        const user = await this.userRepository.getOne(userId);
        const existingCredentials = await this.yubikeyRepository.findWebAuthnCredentialsByUserId(userId);

        const options: GenerateRegistrationOptionsOpts = {
            rpName: RP_NAME,
            rpID: RP_ID,
            userID: new TextEncoder().encode(userId),
            userName: userName,
            userDisplayName: user.name || userName,
            attestationType: 'direct',
            excludeCredentials: existingCredentials.map(cred => ({
                id: cred.credentialId!,
                type: 'public-key',
                transports: cred.transports as any[],
            })),
            authenticatorSelection: {
                userVerification: 'preferred',
                requireResidentKey: false,
            },
        };

        const registrationOptions = await generateRegistrationOptions(options);
        const challengeId = this.generateChallengeId();

        // Store challenge with ID
        this.storeChallenge(challengeId, registrationOptions.challenge, userId);

        return {
            options: registrationOptions,
            challengeId,
        };
    }

    static async verifyWebAuthnRegistration(
        userId: string,
        response: RegistrationResponseJSON,
        challengeId: string,
        nickname?: string
    ): Promise<{verified: boolean; credentialId?: string; error?: string}> {
        try {
            // Retrieve and validate challenge
            const storedChallenge = this.getChallenge(challengeId);
            if (!storedChallenge) {
                return {verified: false, error: 'Invalid or expired challenge'};
            }

            if (storedChallenge.userId !== userId) {
                return {verified: false, error: 'Challenge does not match user'};
            }

            const verification: VerifyRegistrationResponseOpts = {
                response,
                expectedChallenge: storedChallenge.challenge,
                expectedOrigin: ORIGIN,
                expectedRPID: RP_ID,
                requireUserVerification: false,
            };

            const verificationResult = await verifyRegistrationResponse(verification);

            if (verificationResult.verified && verificationResult.registrationInfo) {
                const registrationInfo = verificationResult.registrationInfo;
                const credentialID = registrationInfo.credential.id;
                const credentialPublicKey = registrationInfo.credential.publicKey;
                const counter = registrationInfo.credential.counter;
                const credentialDeviceType = registrationInfo.credentialDeviceType;
                const credentialBackedUp = registrationInfo.credentialBackedUp;

                // Check if credential already exists
                const existingCredential = await this.yubikeyRepository.findByCredentialId(
                    Buffer.from(credentialID).toString('base64url')
                );

                if (existingCredential) {
                    return {verified: false, error: 'Credential already registered'};
                }

                // Save the credential
                const credentialIdBase64 = Buffer.from(credentialID).toString('base64url');
                await this.yubikeyRepository.create({
                    publicId: credentialIdBase64, // Use credentialId as publicId for WebAuthn
                    nickname,
                    userId,
                    credentialId: credentialIdBase64,
                    credentialPublicKey: Buffer.from(credentialPublicKey),
                    counter,
                    credentialDeviceType,
                    credentialBackedUp,
                    transports: response.response.transports || [],
                    authType: AuthType.WEBAUTHN,
                });

                await this.userRepository.update(userId, {
                    twoFactorVerified: true,
                });

                // Clean up challenge
                this.removeChallenge(challengeId);

                return {verified: true, credentialId: credentialIdBase64};
            }

            return {verified: false, error: 'Registration verification failed'};
        } catch (error: any) {
            // Clean up challenge on error
            this.removeChallenge(challengeId);
            return {verified: false, error: error.message};
        }
    }

    static async generateWebAuthnAuthenticationOptions(userId: string): Promise<{options: any; challengeId: string}> {
        const credentials = await this.yubikeyRepository.findWebAuthnCredentialsByUserId(userId);

        const options: GenerateAuthenticationOptionsOpts = {
            rpID: RP_ID,
            allowCredentials: credentials.map(cred => ({
                id: cred.credentialId!,
                type: 'public-key',
                transports: cred.transports as any[],
            })),
            userVerification: 'preferred',
        };

        const authenticationOptions = await generateAuthenticationOptions(options);
        const challengeId = this.generateChallengeId();

        // Store challenge with ID
        this.storeChallenge(challengeId, authenticationOptions.challenge, userId);

        return {
            options: authenticationOptions,
            challengeId,
        };
    }

    static async verifyWebAuthnAuthentication(
        userId: string,
        response: AuthenticationResponseJSON,
        challengeId: string
    ): Promise<{verified: boolean; error?: string}> {
        try {
            // Retrieve and validate challenge
            const storedChallenge = this.getChallenge(challengeId);
            if (!storedChallenge) {
                return {verified: false, error: 'Invalid or expired challenge'};
            }

            if (storedChallenge.userId !== userId) {
                return {verified: false, error: 'Challenge does not match user'};
            }

            const credentialIdBase64 = Buffer.from(response.rawId, 'base64url').toString('base64url');
            const credential = await this.yubikeyRepository.findByUserIdAndCredentialId(userId, credentialIdBase64);

            if (!credential || !credential.credentialPublicKey) {
                return {verified: false, error: 'Credential not found'};
            }

            const verification: VerifyAuthenticationResponseOpts = {
                response,
                expectedChallenge: storedChallenge.challenge,
                expectedOrigin: ORIGIN,
                expectedRPID: RP_ID,
                credential: {
                    id: credential.credentialId!,
                    publicKey: credential.credentialPublicKey!,
                    counter: credential.counter,
                    transports: credential.transports as any[],
                },
                requireUserVerification: false,
            };

            const verificationResult = await verifyAuthenticationResponse(verification);

            if (verificationResult.verified) {
                await this.yubikeyRepository.updateCounter(
                    credential.credentialId!,
                    verificationResult.authenticationInfo.newCounter
                );

                // Clean up challenge
                this.removeChallenge(challengeId);

                return {verified: true};
            }

            return {verified: false, error: 'Authentication verification failed'};
        } catch (error: any) {
            // Clean up challenge on error
            this.removeChallenge(challengeId);
            return {verified: false, error: error.message};
        }
    }
}
