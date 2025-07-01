import logger from '../config/logger';
import Mailjet from 'node-mailjet';
import {EmailTemplateUtil} from '../utils/email-template.util';

export class EmailService {
    private mailjet: Mailjet | null = null;

    constructor() {
        if (process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY) {
            this.mailjet = new Mailjet({
                apiKey: process.env.MAILJET_API_KEY,
                apiSecret: process.env.MAILJET_SECRET_KEY,
            });
        }
    }

    private async sendEmail(to: string, subject: string, htmlContent: string, textContent?: string): Promise<void> {
        if (!this.mailjet) {
            // Mock email in development
            logger.info(`[MOCK EMAIL] To: ${to}`);
            logger.info(`[MOCK EMAIL] Subject: ${subject}`);
            logger.info(`[MOCK EMAIL] Content: ${textContent || htmlContent}`);
            await new Promise(resolve => setTimeout(resolve, 100));
            return;
        }

        try {
            await this.mailjet
                .post('send', {version: 'v3.1'})
                .request({
                    Messages: [
                        {
                            From: {
                                Email: process.env.MAILJET_FROM_EMAIL || 'noreply@yourdomain.com',
                                Name: process.env.MAILJET_FROM_NAME || 'Your App Name',
                            },
                            To: [
                                {
                                    Email: to,
                                },
                            ],
                            Subject: subject,
                            TextPart: textContent || htmlContent.replace(/<[^>]*>/g, ''),
                            HTMLPart: htmlContent,
                        },
                    ],
                })
                .then(() => {
                    logger.info(`Email sent successfully to: ${to}`);
                })
                .catch((error: any) => {
                    throw new Error(`Failed to send email: ${error.message}`);
                });

            logger.info(`Email sent successfully to: ${to}`);
        } catch (error: any) {
            logger.error(`Failed to send email to ${to}:`, error);
            throw new Error(`Failed to send email: ${error.message}`);
        }
    }

    async sendPasswordResetEmail(email: string, resetToken: string): Promise<void> {
        const resetLink = `${process.env.APP_URL}/reset-password?token=${resetToken}`;
        const subject = 'Reset Your Password';

        const {html, text} = EmailTemplateUtil.renderTemplate('password-reset', {
            resetLink,
        });

        await this.sendEmail(email, subject, html, text);
    }

    async sendPasswordResetNotification(userEmail: string, adminEmail: string): Promise<void> {
        const subject = 'Your Password Has Been Reset';

        const {html, text} = EmailTemplateUtil.renderTemplate('password-reset-notification', {
            adminEmail,
        });

        await this.sendEmail(userEmail, subject, html, text);
    }

    async send2FAResetEmail(email: string, resetToken: string, adminEmail?: string): Promise<void> {
        const resetLink = `${process.env.APP_URL}/confirm-reset-2fa?token=${resetToken}`;
        const subject = 'Reset Your Two-Factor Authentication';

        const {html, text} = EmailTemplateUtil.renderTemplate('2fa-reset', {
            resetLink,
            adminEmail,
        });

        await this.sendEmail(email, subject, html, text);
    }

    async send2FAResetNotification(email: string): Promise<void> {
        const subject = 'Your Two-Factor Authentication Has Been Reset';

        const {html, text} = EmailTemplateUtil.renderTemplate('2fa-reset-notification', {
            frontendUrl: process.env.APP_URL,
        });

        await this.sendEmail(email, subject, html, text);
    }
}
