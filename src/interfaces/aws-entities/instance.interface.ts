import {ServiceInterface} from "./service.interface";

export interface InstanceInterface {
    id: string;
    type: string;
    state: string;
    publicIp: string;
    privateIp: string;
    services?: ServiceInterface[];
}
