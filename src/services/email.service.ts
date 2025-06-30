import logger from '../config/logger';

export class EmailService {
    async sendPasswordResetEmail(email: string, resetToken: string): Promise<void> {
        // Mock email sending - replace with actual email service
        const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

        logger.info(`[MOCK EMAIL] Password Reset Email sent to: ${email}`);
        logger.info(`[MOCK EMAIL] Reset Link: ${resetLink}`);
        logger.info(`[MOCK EMAIL] Subject: Reset Your Password`);
        logger.info(`[MOCK EMAIL] Body: Click the following link to reset your password: ${resetLink}`);

        // Simulate email sending delay
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    async sendPasswordResetNotification(userEmail: string, adminEmail: string): Promise<void> {
        // Mock email sending - replace with actual email service
        logger.info(`[MOCK EMAIL] Password Reset Notification sent to: ${userEmail}`);
        logger.info(`[MOCK EMAIL] Subject: Your Password Has Been Reset`);
        logger.info(
            `[MOCK EMAIL] Body: Your password has been reset by an administrator (${adminEmail}). Please log in with your new password.`
        );

        // Simulate email sending delay
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    async send2FAResetEmail(email: string, resetToken: string): Promise<void> {
        // Mock email sending - replace with actual email service
        const resetLink = `${process.env.FRONTEND_URL}/reset-2fa?token=${resetToken}`;

        logger.info(`[MOCK EMAIL] 2FA Reset Email sent to: ${email}`);
        logger.info(`[MOCK EMAIL] Reset Link: ${resetLink}`);
        logger.info(`[MOCK EMAIL] Subject: Reset Your Two-Factor Authentication`);
        logger.info(`[MOCK EMAIL] Body: Click the following link to reset your 2FA: ${resetLink}`);

        // Simulate email sending delay
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    async send2FAResetNotification(email: string): Promise<void> {
        // Mock email sending - replace with actual email service
        logger.info(`[MOCK EMAIL] 2FA Reset Notification sent to: ${email}`);
        logger.info(`[MOCK EMAIL] Subject: Your Two-Factor Authentication Has Been Reset`);
        logger.info(
            `[MOCK EMAIL] Body: Your 2FA has been reset. You can now set up 2FA again from your account settings.`
        );

        // Simulate email sending delay
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}
