import dotenv from 'dotenv';
import {EC2Client} from '@aws-sdk/client-ec2';
import {ECSClient} from "@aws-sdk/client-ecs";

dotenv.config();

export const configuration = {
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
    },
    retryMode: 'standard',
    maxAttempts: 3,
};

export const ecsClient = new ECSClient();
export const ec2Client = new EC2Client();
