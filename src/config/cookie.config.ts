import {CookieOptions, Response} from 'express';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Auth cookie configuration (24 hours)
 */
export const AUTH_COOKIE_CONFIG: CookieOptions = {
    httpOnly: isProduction,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
};

/**
 * Temporary cookie configuration (5 minutes - for 2FA)
 */
export const TEMP_COOKIE_CONFIG: CookieOptions = {
    httpOnly: isProduction,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: 5 * 60 * 1000,
    domain: process.env.COOKIE_SAFE_DOMAIN || 'localhost',
};

export class CookieHelper {
    static setAuthCookie(res: Response, token: string): void {
        res.cookie('token', token, AUTH_COOKIE_CONFIG);
    }

    static setTempCookie(res: Response, token: string): void {
        res.cookie('token', token, TEMP_COOKIE_CONFIG);
    }

    static clearAuthCookie(res: Response): void {
        res.clearCookie('token', {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'strict',
            path: '/',
        });
    }

    static clearAllAuthCookies(res: Response): void {
        this.clearAuthCookie(res);
        res.clearCookie('auth', {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'strict',
            path: '/',
        });
    }
}
