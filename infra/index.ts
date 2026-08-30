import * as pulumi from "@pulumi/pulumi";
import { ArhamAwsIndiaStack } from "./aws-india";

const stack = pulumi.getStack();

if (stack !== "aws-india") {
  throw new Error(`Unknown stack: ${stack}. Valid stacks: aws-india`);
}

const infra = new ArhamAwsIndiaStack("arham");
export const mailIp          = infra.mailElasticIp;
/** "host:port" — for psql URLs. Scripts wanting a bare host must use dbAddress. */
export const dbEndpoint      = infra.dbEndpoint;
/** Bare hostname, no port — this is the one to feed to PGHOST / config files. */
export const dbAddress       = infra.dbAddress;
export const s3BlobBucket    = infra.s3BlobBucket;
export const sesSmtpUser     = infra.sesSmtpUser;
export const sesSmtpPassword = infra.sesSmtpPassword;
export const sesDkimTokens   = infra.sesDkimTokens;
export const alertsTopicArn  = infra.alertsTopicArn;
