import dotenv from 'dotenv';
import {EC2Client} from '@aws-sdk/client-ec2';
import {ECSClient} from "@aws-sdk/client-ecs";
import {fromContainerMetadata} from "@aws-sdk/credential-providers";

dotenv.config();

// export const configuration = {
//     region: process.env.AWS_REGION,
//     credentials: {
//         accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
//         secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!
//     },
//     retryMode: 'standard',
//     maxAttempts: 3,
// };

const configuration = {
    credentials: fromContainerMetadata({
        timeout: 1000,
        maxRetries: 0
    })
}

export const ecsClient = new ECSClient(configuration);
export const ec2Client = new EC2Client(configuration);
