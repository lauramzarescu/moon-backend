import express from "express";
import bcrypt from "bcrypt";
import {AuthService} from "../../services/auth.service";
import {UserRepository} from "../../repositories/user/user.repository";
import moment from "moment";
import {loginSchema} from "./auth.schema";
import {prisma} from "../../config/db.config";
import {UserController} from "../user/user.controller";

export class AuthController {
    static userRepository = new UserRepository(prisma);

    constructor() {
    }

    static login = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const validatedData = loginSchema.parse(req.body);

            const user = await this.userRepository.findOneWhere({
                email: validatedData.email
            });

            if (!user) {
                res.status(401).json({error: 'Invalid credentials'})
                return;
            }

            if (user.loginType !== 'local' || !user.password) {
                res.status(401).json({error: 'Invalid login type'});
                return;
            }

            const isValidPassword = await bcrypt.compare(validatedData.password, user.password);

            if (!isValidPassword) {
                res.status(401).json({error: 'Invalid credentials'});
                return;
            }

            const verificationRequired = await UserController.is2FAVerificationNeeded(user.id, req)

            if (verificationRequired) {
                const tempToken = AuthService.createTemporaryToken(user);

                res.cookie('token', tempToken, {
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    expires: moment().add(5, 'm').toDate()
                });

                res.json({
                    status: 'success',
                    requires2FAVerification: true,
                });
            } else {
                const token = AuthService.createToken(user);

                res.cookie('token', token, {
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    expires: moment().add(24, 'h').toDate()
                });

                res.json({
                    status: 'success',
                    requires2FAVerification: false
                });
                return;
            }
        } catch (error) {
            console.error(error);
            res.status(500).json({error: 'Login failed'});
        }
    }
}