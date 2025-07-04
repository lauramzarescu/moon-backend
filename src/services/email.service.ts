import logger from '../config/logger';
import Mailjet from 'node-mailjet';
import {EmailTemplateUtil} from '../utils/email-template.util';
import * as mandrill from 'mandrill-api';

export class EmailService {
    private mailjet: Mailjet | null = null;
    private mandrillClient: mandrill.Mandrill | null = null;
    private emailProvider: 'mailjet' | 'mandrill' | 'mock' = 'mock';

    constructor() {
        // Try Mailjet first
        if (process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY) {
            this.mailjet = new Mailjet({
                apiKey: process.env.MAILJET_API_KEY,
                apiSecret: process.env.MAILJET_SECRET_KEY,
            });
            this.emailProvider = 'mailjet';
            logger.info('Email service initialized with Mailjet');
        }
        // Fallback to Mandrill
        else if (process.env.MANDRILL_API_KEY && process.env.MANDRILL_SECRET_KEY) {
            this.mandrillClient = new mandrill.Mandrill(process.env.MANDRILL_API_KEY);
            this.emailProvider = 'mandrill';
            logger.info('Email service initialized with Mandrill');
        }
        // Mock mode for development
        else {
            this.emailProvider = 'mock';
            logger.info('Email service initialized in mock mode');
        }
    }

    private async sendEmailWithMailjet(
        to: string,
        subject: string,
        htmlContent: string,
        textContent?: string
    ): Promise<void> {
        if (!this.mailjet) {
            throw new Error('Mailjet client not initialized');
        }

        try {
            await this.mailjet.post('send', {version: 'v3.1'}).request({
                Messages: [
                    {
                        From: {
                            Email: process.env.MAILJET_FROM_EMAIL || 'noreply@gmail.com',
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
            });

            logger.info(`Email sent successfully via Mailjet to: ${to}`);
        } catch (error: any) {
            logger.error(`Failed to send email via Mailjet to ${to}:`, error);
            throw new Error(`Failed to send email via Mailjet: ${error.message}`);
        }
    }

    private async sendEmailWithMandrill(
        to: string,
        subject: string,
        htmlContent: string,
        textContent?: string
    ): Promise<void> {
        if (!this.mandrillClient) {
            throw new Error('Mandrill client not initialized');
        }

        return new Promise((resolve, reject) => {
            const message = {
                message: {
                    html: htmlContent,
                    text: textContent || htmlContent.replace(/<[^>]*>/g, ''),
                    subject: subject,
                    from_email: process.env.MANDRILL_FROM_EMAIL || 'noreply@gmail.com',
                    from_name: process.env.MANDRILL_FROM_NAME || 'Your App Name',
                    to: [
                        {
                            email: to,
                            type: 'to',
                        },
                    ],
                    headers: {
                        'Reply-To': process.env.MANDRILL_FROM_EMAIL || 'noreply@gmail.com',
                    },
                    important: false,
                    track_opens: true,
                    track_clicks: true,
                    auto_text: true,
                    auto_html: false,
                    inline_css: true,
                    url_strip_qs: false,
                    preserve_recipients: false,
                    view_content_link: false,
                },
            };

            this.mandrillClient!.messages.send(
                message,
                (result: any) => {
                    logger.info(`Email sent successfully via Mandrill to: ${to}`, result);
                    resolve();
                },
                (error: any) => {
                    logger.error(`Failed to send email via Mandrill to ${to}:`, error);
                    reject(new Error(`Failed to send email via Mandrill: ${error.message || error.name}`));
                }
            );
        });
    }

    private async sendMockEmail(to: string, subject: string, htmlContent: string, textContent?: string): Promise<void> {
        logger.info(`[MOCK EMAIL] To: ${to}`);
        logger.info(`[MOCK EMAIL] Subject: ${subject}`);
        logger.info(`[MOCK EMAIL] Content: ${textContent || htmlContent}`);
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    private async sendEmail(to: string, subject: string, htmlContent: string, textContent?: string): Promise<void> {
        try {
            switch (this.emailProvider) {
                case 'mailjet':
                    await this.sendEmailWithMailjet(to, subject, htmlContent, textContent);
                    break;
                case 'mandrill':
                    await this.sendEmailWithMandrill(to, subject, htmlContent, textContent);
                    break;
                case 'mock':
                default:
                    await this.sendMockEmail(to, subject, htmlContent, textContent);
                    break;
            }
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

    async sendInvitationEmail(email: string, adminEmail: string, resetToken: string): Promise<void> {
        const resetLink = `${process.env.APP_URL}/reset-password?token=${resetToken}`;
        const subject = 'Set Your Password';

        const {html, text} = EmailTemplateUtil.renderTemplate('user-invitation', {
            adminEmail,
            resetLink,
        });

        await this.sendEmail(email, subject, html, text);
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

    // Utility method to get current email provider
    getEmailProvider(): string {
        return this.emailProvider;
    }
}
