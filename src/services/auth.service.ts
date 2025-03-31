import jwt, {JwtPayload} from 'jsonwebtoken';
import {getPermissionsForRole} from './rbac.service';
import {User} from '@prisma/client';
import {PermissionEnum} from '../enums/rbac/permission.enum';
import {JwtInterface} from '../interfaces/jwt/jwt.interface';

export class AuthService {
    constructor() {}

    static createTemporaryToken(user: any) {
        return jwt.sign(
            {
                userId: user.id,
                email: user.email,
                temp: true,
            },
            process.env.JWT_SECRET || 'your-secret-key',
            {expiresIn: '5m'}
        );
    }

    static createToken(user: User) {
        return jwt.sign(
            {
                userId: user.id,
                permissions: getPermissionsForRole(user.role),
                role: user.role,
                loginType: user.loginType,
            },
            process.env.JWT_SECRET as string,
            {expiresIn: '24h'}
        );
    }

    static decodeToken(token: string | null | undefined) {
        // check if the token provided is starting with Bearer and get only the jwt
        if (token?.startsWith('Bearer ')) {
            token = token.split(' ')[1];
        }

        if (!token) {
            throw new Error('No token provided');
        }

        return jwt.verify(token, process.env.JWT_SECRET as string) as JwtInterface;
    }

    static tokenHasPermissions(
        decodedToken: JwtPayload & {
            permissions: PermissionEnum[];
        },
        permissions: PermissionEnum[]
    ) {
        return permissions.every(permission => decodedToken.permissions.includes(permission));
    }
}
