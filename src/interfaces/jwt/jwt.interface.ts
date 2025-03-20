import {PermissionEnum} from "../../enums/rbac/permission.enum";
import {LoginType, UserRole} from "@prisma/client";
import {JwtPayload} from "jsonwebtoken";

export interface JwtInterface extends JwtPayload {
    userId: string;
    email: string;
    permissions: PermissionEnum[];
    role: UserRole;
    name: string;
    loginType: LoginType;
}