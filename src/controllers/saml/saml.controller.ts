import express from 'express'
import passport from "passport";
import {initializeSamlAuth} from "../../config/saml.strategy";
import {SamlConfig, User} from "@prisma/client";
import {SamlConfigRepository} from "../../repositories/saml-config/saml-config.repository";
import {AuthService} from "../../services/auth.service";
import {UserRepository} from "../../repositories/user/user.repository";
import {samlConfigDeleteWith2FASchema, samlConfigSchema, samlConfigUpdateSchema} from "./saml-config.schema";
import {SamlService} from "../../services/saml.service";
import {Strategy} from "passport-saml";
import {prisma} from "../../config/db.config";
import * as speakeasy from 'speakeasy';

export class SamlController {
    static samlConfigRepository = new SamlConfigRepository(prisma);
    static userRepository = new UserRepository(prisma);

    static login = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const originUrl = req.headers.referer || process.env.APP_URL;
            console.log('Origin URL:', originUrl);
            const strategyName = await initializeSamlAuth(originUrl as string);

            res.header('Access-Control-Allow-Origin', originUrl || 'http://localhost:5173');
            res.header('Access-Control-Allow-Credentials', 'true');

            return passport.authenticate(strategyName, {
                successRedirect: process.env.APP_URL,
                failureRedirect: '/login',
                failureFlash: true,
            })(req, res, next);
        } catch (error) {
            console.error('Error during SAML login:', error);
            res.redirect(`${process.env.APP_URL}/login`)
        }
    }

    static callback = (req: express.Request, res: express.Response, next: express.NextFunction) => {
        passport.authenticate(
            req.query.strategy as string,
            {
                session: true,
                keepSessionInfo: true
            },
            (err: any, user: any, info: any) => {
                if (err) {
                    console.error('SAML Authentication error:', err);
                    res.redirect(`${process.env.APP_URL}/login`);
                    return;
                }

                if (!user) {
                    console.log('No user from SAML auth:', info);
                    res.redirect(`${process.env.APP_URL}/login`);
                    return;
                }

                req.logIn(user, (loginErr) => {
                    if (loginErr) {
                        console.error('Login error:', loginErr);
                        res.redirect(`${process.env.APP_URL}/login`);
                        return;
                    }

                    const token = AuthService.createToken(user);

                    res.cookie('token', token, {
                        secure: process.env.NODE_ENV === 'production',
                        sameSite: 'strict'
                    });

                    res.redirect(process.env.APP_URL || '/');
                    return;
                });
            })(req, res, next);
    }

    static metadata = (req: express.Request, res: express.Response) => {
        res.send(req.body)
        // const metadata = strategy.generateServiceProviderMetadata(
        //     process.env.SP_CERT ?? '',
        //     process.env.SP_PRIVATE_KEY
        // );
        // res.type('application/xml');
        // res.send(metadata);
    }

    static loginSuccess = (req: express.Request, res: express.Response) => {
        res.send('Login successful');
    }

    static logout = (req: express.Request, res: express.Response) => {
        try {
            this.logoutProcess(req, res);
        } catch (error) {
            console.error('Logout error:', error);
            res.status(500).send('Error during logout');
        }
    };

    static samlLogout = async (req: express.Request, res: express.Response) => {
        try {
            const originUrl = req.headers.referer || process.env.APP_URL;
            const samlConfig = await this.samlConfigRepository.getOneWhere({entityId: originUrl});
            const strategyName = SamlService.buildSamlStrategyName(samlConfig.id);
            const samlStrategy = (passport as any)._strategies[strategyName] as Strategy;
            const requesterUser = req.user as User;

            if (!samlStrategy?.logout) {
                this.logoutProcess(req, res);
                return;
            }

            samlStrategy.logout({
                user: requesterUser,
                samlLogoutRequest: req
            } as any, (err: Error | null, url: string | null | undefined) => {
                if (err) {
                    res.status(500).send('Error during SAML logout');
                    return;
                }

                req.logout(() => {
                    res.clearCookie('token');
                    res.clearCookie('auth');

                    if (url) {
                        res.status(200).json({url});
                        return;
                    }

                    res.redirect(`${originUrl}/login`);
                });
            })
        } catch (error) {
            console.error('Logout error:', error);
            res.status(500).send('Error during logout');
        }
    };

    static samlLogoutCallback = (req: express.Request, res: express.Response) => {
        res.send('SAML logout callback');
    }

    static logoutProcess = (req: express.Request, res: express.Response) => {
        req.logout(function (err: Error | null) {
            if (err) {
                res.status(500).send('Error during logout');
                return;
            }

            res.clearCookie('token');
            res.clearCookie('auth');

            req.session.destroy(() => {
                res.status(200).json('Logout successful');
            });
        });
    }

    static createConfiguration = async (req: express.Request, res: express.Response) => {
        try {
            console.log('Creating SAML config...');
            const token = AuthService.decodeToken(req.headers.authorization?.split(' ')[1]);
            const user = await this.userRepository.getOneWhere({id: token.userId});

            const validatedData = samlConfigSchema.parse(req.body);
            const samlConfig: SamlConfig = await this.samlConfigRepository.create({
                entityId: validatedData.entityId,
                metadataUrl: validatedData.metadataUrl,
                serviceProviderX509Certificate: validatedData.x509Certificate,
                serviceProviderPrivateKey: validatedData.privateKey,
                organizationId: user.organizationId
            });

            console.log('SAML config created:');
            res.status(201).json(samlConfig);
        } catch (error) {
            console.error(error);
            res.status(500).json({error: 'Failed to create SAML configuration'});
        }
    }

    static getConfiguration = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const user = await this.userRepository.getOneWhere({id: token.userId});

            const configuration = await this.samlConfigRepository.findOneWhere({organizationId: user.organizationId});

            if (configuration) {
                const sanitizedConfig = {
                    ...configuration,
                    serviceProviderPrivateKey: configuration.serviceProviderPrivateKey
                        ? [...configuration.serviceProviderPrivateKey.split('\n').slice(0, 2),
                            '[PRIVATE_KEY_HIDDEN]',
                            ...configuration.serviceProviderPrivateKey.split('\n').slice(-3)
                        ].join('\n')
                        : null
                };

                res.json(sanitizedConfig);
            } else {
                res.json(null);
            }
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    }

    static updateConfiguration = async (req: express.Request, res: express.Response) => {
        const configurationId = req.params.id;

        if (!configurationId) {
            res.status(400).json({error: 'Configuration ID is required'});
            return;
        }

        try {
            const validatedData = samlConfigUpdateSchema.parse(req.body);
            const updatedConfig = await this.samlConfigRepository.update(
                req.params.id,
                {
                    entityId: validatedData.entityId,
                    metadataUrl: validatedData.metadataUrl,
                    serviceProviderX509Certificate: validatedData.x509Certificate,
                    serviceProviderPrivateKey: validatedData.privateKey,
                }
            );
            console.log('SAML config updated');
            res.json(updatedConfig);
        } catch (error) {
            console.error(error);
            res.status(500).json({error: 'Failed to update SAML configuration'});
        }
    }

    static deleteConfiguration = async (req: express.Request, res: express.Response) => {
        const configurationId = req.params.id;

        if (!configurationId) {
            res.status(400).json({error: 'Configuration ID is required'});
            return;
        }

        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const user = await this.userRepository.getOne(token.userId);

            if (user.twoFactorSecret && user.twoFactorVerified) {
                res.status(400).json({error: 'You must verify your 2FA before deleting the configuration.'});
                return;
            }

            const deletedConfig = await this.samlConfigRepository.delete(req.params.id);
            res.json({id: deletedConfig.id});
        } catch (error) {
            console.error(error);
            res.status(500).json({error: 'Failed to delete SAML configuration'});
        }
    }

    static delete2FAConfiguration = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const user = await this.userRepository.getOne(token.userId);

            if (!user.twoFactorSecret || !user.twoFactorVerified) {
                res.status(400).json({error: '2FA is not enabled or verified for this account'});
                return;
            }

            const validatedData = samlConfigDeleteWith2FASchema.parse(req.body);

            const verified = speakeasy.totp.verify({
                secret: user.twoFactorSecret,
                encoding: 'base32',
                token: validatedData.code
            });

            if (!verified) {
                res.status(400).json({error: 'Invalid 2FA verification code'});
                return;
            }

            const samlConfig = await this.samlConfigRepository.findOneWhere({
                organizationId: user.organizationId
            });

            if (!samlConfig) {
                res.status(404).json({error: 'SAML configuration not found'});
                return;
            }

            const deletedConfig = await this.samlConfigRepository.delete(samlConfig.id);

            res.json({
                success: true,
                message: 'SAML configuration deleted successfully with 2FA verification',
                id: deletedConfig.id
            });
        } catch (error: any) {
            console.error('Error deleting SAML configuration with 2FA:', error);
            res.status(500).json({error: error.message});
        }
    }

}
