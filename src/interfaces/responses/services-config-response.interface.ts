import {AWSConfig} from "../../controllers/services-config/helper";

export interface ServicesConfigResponseInterface {
    aws: AWSConfig,
    digitalOcean: any,
    gcp: any,
}