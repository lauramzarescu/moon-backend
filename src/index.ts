import express, {Router} from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {app, httpServer} from './config/socket.config';
import session from 'express-session';
import passport from 'passport';
import authRoute from './routes/auth.route';
import samlConfigRoute from './routes/saml-config.route';
import helmet from 'helmet';
import organizationRoute from './routes/organization.route';
import servicesConfigRoute from './routes/services-config.route';
import cookieParser from 'cookie-parser';
import userRoute from './routes/user.route';
import accessControlRoute from './routes/access-control.route';
import awsRoutes from './routes/aws.routes';
import healthcheckRoute from './routes/healthcheck.route';
import {initPrisma} from './config/db.config';
import {extractIpMiddleware} from './middlewares/extract-ip.middleware';
import actionRoute from './routes/action.route';
import {JobSchedulerService} from './services/scheduler/job-scheduler.service';
import {closePgBossInstance} from './config/pg-boss.config';

dotenv.config();

const router = Router();
const jobScheduler = new JobSchedulerService();

app.use(helmet());
app.use((req, res, next) => {
    res.header('X-Frame-Options', 'DENY');
    res.header('Content-Security-Policy', "frame-ancestors 'none'");
    next();
});

app.use(cookieParser());
app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({limit: '50mb', extended: true}));

const corsOptions = {
    origin: [process.env.APP_URL || 'http://localhost:5173', process.env.API_URL || 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

app.use(
    session({
        secret: process.env.SESSION_SECRET || 'your-secret-key',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
            sameSite: 'strict',
        },
    })
);

app.use(passport.initialize());
app.use(passport.session());

router.use(extractIpMiddleware);

router.use('/v1/status', healthcheckRoute);
router.use('/v1/auth', authRoute);
router.use('/v1/users', userRoute);
router.use('/v1/saml-config', samlConfigRoute);
router.use('/v1/organizations', organizationRoute);
router.use('/v1/services', servicesConfigRoute);
router.use('/v1/access-control', accessControlRoute);
router.use('/v1/aws', awsRoutes);
router.use('/v1/actions', actionRoute);

app.use(router);

const port = process.env.APP_PORT || 8001;

initPrisma(5, 5000)
    .then(() => {
        httpServer.listen(port, () => {
            console.log(`Server running at http://localhost:${port}`);

            // Initialize the job scheduler
            jobScheduler.initialize().then(() => {
                console.log('Job scheduler initialized');
            });
        });
    })
    .catch(err => {
        console.error('Failed to initialize database connection:', err);
        process.exit(1);
    });

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    await jobScheduler.stop();
    await closePgBossInstance();
    process.exit(0);
});
