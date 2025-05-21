import {ServiceInterface} from './service.interface';
import {InstanceStateName} from '@aws-sdk/client-ec2/dist-types/models';

export interface InstanceInterface {
    id: string;
    type: string;
    state: InstanceStateName | undefined;
    name: string;
    publicIp: string;
    primaryPrivateIp: string;
    privateIpAddresses: string[];
    services?: ServiceInterface[];
}
