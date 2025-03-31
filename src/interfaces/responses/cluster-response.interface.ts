import {ClusterInterface} from '../aws-entities/cluster.interface';
import {InstanceInterface} from '../aws-entities/instance.interface';

export interface ClusterResponse {
    clusters: {
        clusters: ClusterInterface[];
    };
    ec2Instances: {
        instances: InstanceInterface[];
    };
    updatedOn: string;
}
