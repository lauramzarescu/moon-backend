import {UserRole} from '@prisma/client';
import {UserRepository} from '../../repositories/user/user.repository';
import {PaginationParams} from '../../utils/pagination.util';
import {prisma} from '../../config/db.config';

export class UserHelper {
    static userRepository = new UserRepository(prisma);

    static getAuthorized = async (requesterUserId: string) => {
        const requestingUser = await this.userRepository.getOneWhere({id: requesterUserId});

        if (requestingUser.role === UserRole.root) {
            return this.userRepository.getAll();
        }

        if (requestingUser.role === UserRole.admin) {
            return this.userRepository.getMany({
                organizationId: requestingUser.organizationId,
                role: {notIn: [UserRole.root]},
            });
        }

        return this.userRepository.getMany({
            organizationId: requestingUser.organizationId,
            role: UserRole.user,
        });
    };

    static getAuthorizedPaginated = async (requesterUserId: string, params: PaginationParams) => {
        const requestingUser = await this.userRepository.getOneWhere({id: requesterUserId});

        if (requestingUser.role === UserRole.root) {
            return this.userRepository.getPaginated(params);
        }

        if (requestingUser.role === UserRole.admin) {
            return this.userRepository.getPaginated(params, {
                organizationId: requestingUser.organizationId,
                role: {notIn: [UserRole.root]},
            });
        }

        return this.userRepository.getPaginated(params, {
            organizationId: requestingUser.organizationId,
            role: UserRole.user,
        });
    };
}
