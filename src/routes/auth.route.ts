import express from 'express';
import {AuthController} from '../controllers/auth/auth.controller';
import {SamlController} from '../controllers/saml/saml.controller';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {checkAccessControlPasswordGuard} from '../middlewares/access-control.middleware';

const router = express.Router();

/** Login with SAML */
router.get('/saml/login', SamlController.login);

/** Login with email and password */
router.post('/login', checkAccessControlPasswordGuard, AuthController.login);

router.post('/callback', SamlController.callback);

router.get('/metadata', SamlController.metadata);

router.get('/success', isAuthenticatedGuard([]), SamlController.loginSuccess);

router.post('/logout', isAuthenticatedGuard([]), SamlController.logout);

router.post('/saml/logout', isAuthenticatedGuard([]), SamlController.samlLogout);

router.post('/saml/logout/callback', SamlController.samlLogoutCallback);

export default router;
