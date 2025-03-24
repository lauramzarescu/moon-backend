import dotenv from 'dotenv';
import {EC2Client} from '@aws-sdk/client-ec2';
import {ECSClient} from "@aws-sdk/client-ecs";
import {fromInstanceMetadata} from "@aws-sdk/credential-providers";

dotenv.config();

let credentials;
try {
    credentials = fromInstanceMetadata({
        timeout: 1000,
        maxRetries: 0
    })
} catch (error) {
    // Fallback to environment variables
    credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
    }
}

const configuration = {
    region: process.env.AWS_REGION,
    retryMode: 'standard',
    maxAttempts: 3,
    // credentials: credentials
};


export const ecsClient = new ECSClient(configuration);
export const ec2Client = new EC2Client(configuration);