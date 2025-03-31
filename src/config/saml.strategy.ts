import passport from 'passport';
import {Strategy as SamlStrategy} from 'passport-saml';
import {LoginType, SamlConfig} from '@prisma/client';
import {SamlService} from '../services/saml.service';
import {SamlConfigRepository} from '../repositories/saml-config/saml-config.repository';
import {UserRepository} from '../repositories/user/user.repository';
import {AccessControlHelper} from '../controllers/access-control/helper';
import {prisma} from './db.config';

const samlConfigRepository = new SamlConfigRepository(prisma);
const userRepository = new UserRepository(prisma);

passport.serializeUser((user: any, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
    try {
        const user = await prisma.user.findUnique({
            where: {id},
        });
        done(null, user);
    } catch (err) {
        done(err);
    }
});

// Create a function to generate strategy based on tenant/user
const createSamlStrategy = async (samlConfig: SamlConfig, strategyName: string) => {
    const results = await SamlService.extractSamlIdpInfo(samlConfig.metadataUrl);
    const dynamicSamlConfig = {
        name: strategyName,

        entryPoint: results.singleSignOnServices[0].location,
        callbackUrl: `${process.env.API_URL}/auth/callback?strategy=${strategyName}`,

        logoutUrl: results.singleLogoutServices?.[0]?.location,
        logoutCallbackUrl: `${process.env.API_URL}/auth/saml/logout/callback`,

        issuer: samlConfig.entityId,
        cert: samlConfig.serviceProviderX509Certificate,
        privateKey: samlConfig.serviceProviderPrivateKey.split(String.raw`\n`).join('\n'),

        forceAuthn: true,
        validateInResponseTo: true, // For secure logout
        disableRequestedAuthnContext: true,
        acceptedClockSkewMs: -1,
    };

    passport.use(
        strategyName,
        new SamlStrategy(dynamicSamlConfig, async (profile: any, done: any) => {
            try {
                const accessControlHelper = new AccessControlHelper();

                const isAllowed = await accessControlHelper.checkAccess(profile.email, samlConfig.organizationId);
                if (!isAllowed) {
                    throw new Error('Access denied');
                }

                const user = await userRepository.upsert(
                    {
                        email: profile.email,
                        name: profile.displayName,
                        nameID: profile.nameID,
                        nameIDFormat: profile.nameIDFormat,
                        sessionIndex: profile.sessionIndex,
                        loginType: LoginType.saml,
                        organizationId: samlConfig.organizationId,
                    },
                    {email: profile.email}
                );
                return done(null, user);
            } catch (err) {
                done(err);
            }
        })
    );

    return (passport as any)._strategies[strategyName];
};

const initializeSamlAuth = async (samlIdentifier: string) => {
    const samlConfig = await samlConfigRepository.getOneWhere({entityId: samlIdentifier});
    const strategyName = SamlService.buildSamlStrategyName(samlConfig.id);

    await createSamlStrategy(samlConfig, strategyName);

    return strategyName;
};

export {createSamlStrategy, initializeSamlAuth};
