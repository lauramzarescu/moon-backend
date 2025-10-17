import {CookieOptions, Response} from 'express';

const isProd = process.env.NODE_ENV !== 'dev';

/**
 * Auth cookie configuration (24 hours)
 */
export const AUTH_COOKIE_CONFIG: CookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'none',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
};

/**
 * Temporary cookie configuration (5 minutes - for 2FA)
 */
export const TEMP_COOKIE_CONFIG: CookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'none',
    path: '/',
    maxAge: 5 * 60 * 1000,
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
            secure: true,
            sameSite: 'strict',
            path: '/',
        });
    }

    static clearAllAuthCookies(res: Response): void {
        this.clearAuthCookie(res);
        res.clearCookie('auth', {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            path: '/',
        });
    }
}
