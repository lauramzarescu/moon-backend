export interface ContainerInterface {
    image: string
    cpu: number
    memory: string | number
    name: string
    environmentVariables: {
        environment: Array<{ name: string; value: string }>
        environmentFiles: any[]
        secrets: any[]
    }
}
