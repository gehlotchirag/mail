import * as pulumi from "@pulumi/pulumi";
import { ArhamAwsIndiaStack } from "./aws-india";

const stack = pulumi.getStack();

if (stack === "aws-india") {
  const infra = new ArhamAwsIndiaStack("arham");
  export const mailIp        = infra.mailElasticIp;
  export const auroraEndpoint = infra.auroraEndpoint;
  export const redisEndpoint  = infra.redisEndpoint;
  export const s3BlobBucket   = infra.s3BlobBucket;
  export const albDns         = infra.albDns;
} else {
  throw new Error(`Unknown stack: ${stack}. Valid stacks: aws-india`);
}
