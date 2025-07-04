import {UserRole} from '@prisma/client';
import {PermissionEnum} from '../enums/rbac/permission.enum';

export const RolePermissions: Record<UserRole, PermissionEnum[] | '*'> = {
    root: '*',
    admin: '*',
    user: [
        PermissionEnum.USER_READ,
        PermissionEnum.ORGANIZATION_READ,
        PermissionEnum.SAML_CONFIGURATION_READ,
        PermissionEnum.ACCESS_CONTROL_READ,
        PermissionEnum.AWS_CLUSTER_READ,
        PermissionEnum.AWS_CLUSTER_WRITE,
        PermissionEnum.AWS_SERVICE_READ,
        PermissionEnum.AWS_SCHEDULED_TASK_READ,
        PermissionEnum.ACTIONS_READ,
    ],
};

export const getPermissionsForRole = (role: UserRole): PermissionEnum[] => {
    const permissions = RolePermissions[role];

    if (permissions === '*') {
        return Object.values(PermissionEnum);
    }

    return permissions;
};
