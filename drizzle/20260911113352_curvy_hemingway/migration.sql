CREATE TABLE `attempt_contents` (
	`id` text PRIMARY KEY,
	`attemptId` text NOT NULL,
	`captureStatus` text NOT NULL,
	`requestHeaders` text,
	`requestBody` text,
	`responseStatus` integer,
	`responseHeaders` text,
	`responseBody` text,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `fk_attempt_contents_attemptId_request_attempts_id_fk` FOREIGN KEY (`attemptId`) REFERENCES `request_attempts`(`id`),
	CONSTRAINT "chk_attempt_contents_capture_status" CHECK("captureStatus" in ('captured', 'partial'))
);
--> statement-breakpoint
CREATE TABLE `attempt_usages` (
	`type` text NOT NULL,
	`value` real,
	`rawValue` text,
	`attemptId` text NOT NULL,
	`createdTime` integer NOT NULL,
	CONSTRAINT `attempt_usages_pk` PRIMARY KEY(`attemptId`, `type`),
	CONSTRAINT `fk_attempt_usages_attemptId_request_attempts_id_fk` FOREIGN KEY (`attemptId`) REFERENCES `request_attempts`(`id`),
	CONSTRAINT "chk_attempt_usages_type" CHECK("type" in ('inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheCreationInputTokens', 'reasoningTokens', 'raw')),
	CONSTRAINT "chk_attempt_usages_value_shape" CHECK(("type" = 'raw' and "value" is null and "rawValue" is not null) or ("type" <> 'raw' and "value" is not null and "rawValue" is null))
);
--> statement-breakpoint
CREATE TABLE `logical_models` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL UNIQUE,
	`enabled` integer DEFAULT true NOT NULL,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
);
--> statement-breakpoint
CREATE TABLE `protocol_converters` (
	`id` text PRIMARY KEY,
	`enabled` integer DEFAULT false NOT NULL,
	`clientProtocol` text NOT NULL,
	`providerModelEndpointId` text NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer,
	CONSTRAINT `fk_protocol_converters_providerModelEndpointId_provider_model_endpoints_id_fk` FOREIGN KEY (`providerModelEndpointId`) REFERENCES `provider_model_endpoints`(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_endpoints` (
	`id` text PRIMARY KEY,
	`url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`protocol` text NOT NULL,
	`providerId` text NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer,
	CONSTRAINT `fk_provider_endpoints_providerId_providers_id_fk` FOREIGN KEY (`providerId`) REFERENCES `providers`(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_health` (
	`providerId` text PRIMARY KEY,
	`updatedTime` integer NOT NULL,
	`lastSuccessTime` integer,
	`lastFailureTime` integer,
	`cooldownUntilTime` integer,
	`consecutiveFailures` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_provider_health_providerId_providers_id_fk` FOREIGN KEY (`providerId`) REFERENCES `providers`(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_model_endpoints` (
	`id` text PRIMARY KEY,
	`url` text,
	`enabled` integer DEFAULT true NOT NULL,
	`providerModelId` text NOT NULL,
	`providerEndpointId` text NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer,
	CONSTRAINT `fk_provider_model_endpoints_providerModelId_provider_models_id_fk` FOREIGN KEY (`providerModelId`) REFERENCES `provider_models`(`id`),
	CONSTRAINT `fk_provider_model_endpoints_providerEndpointId_provider_endpoints_id_fk` FOREIGN KEY (`providerEndpointId`) REFERENCES `provider_endpoints`(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_model_health` (
	`providerModelId` text PRIMARY KEY,
	`updatedTime` integer NOT NULL,
	`lastSuccessTime` integer,
	`lastFailureTime` integer,
	`cooldownUntilTime` integer,
	`consecutiveFailures` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_provider_model_health_providerModelId_provider_models_id_fk` FOREIGN KEY (`providerModelId`) REFERENCES `provider_models`(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_model_request_rewrite_rules` (
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer NOT NULL,
	`providerModelId` text NOT NULL,
	`requestRewriteRuleId` text NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer,
	CONSTRAINT `provider_model_request_rewrite_rules_pk` PRIMARY KEY(`providerModelId`, `requestRewriteRuleId`),
	CONSTRAINT `fk_provider_model_request_rewrite_rules_providerModelId_provider_models_id_fk` FOREIGN KEY (`providerModelId`) REFERENCES `provider_models`(`id`),
	CONSTRAINT `fk_provider_model_request_rewrite_rules_requestRewriteRuleId_request_rewrite_rules_id_fk` FOREIGN KEY (`requestRewriteRuleId`) REFERENCES `request_rewrite_rules`(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_models` (
	`id` text PRIMARY KEY,
	`enabled` integer DEFAULT true NOT NULL,
	`modelName` text NOT NULL,
	`providerId` text NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer,
	CONSTRAINT `fk_provider_models_providerId_providers_id_fk` FOREIGN KEY (`providerId`) REFERENCES `providers`(`id`)
);
--> statement-breakpoint
CREATE TABLE `provider_settings` (
	`key` text NOT NULL,
	`value` text NOT NULL,
	`valueType` text DEFAULT 'string' NOT NULL,
	`providerId` text NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `provider_settings_pk` PRIMARY KEY(`providerId`, `key`),
	CONSTRAINT `fk_provider_settings_providerId_providers_id_fk` FOREIGN KEY (`providerId`) REFERENCES `providers`(`id`)
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
);
--> statement-breakpoint
CREATE TABLE `request_attempts` (
	`id` text PRIMARY KEY,
	`requestId` text NOT NULL,
	`providerId` text NOT NULL,
	`providerModelId` text NOT NULL,
	`providerName` text NOT NULL,
	`providerModelName` text NOT NULL,
	`upstreamProtocol` text,
	`upstreamRequestId` text,
	`url` text NOT NULL,
	`status` text NOT NULL,
	`httpStatus` integer,
	`retryable` integer DEFAULT false NOT NULL,
	`upstreamTransport` text,
	`attemptIndex` integer NOT NULL,
	`durationMilliseconds` integer NOT NULL,
	`ttftMilliseconds` integer,
	`errorCode` text,
	`errorMessage` text,
	`requestRewriteRuleIds` text DEFAULT '[]' NOT NULL,
	`responseRewriteRuleIds` text DEFAULT '[]' NOT NULL,
	`createdTime` integer NOT NULL,
	CONSTRAINT `fk_request_attempts_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`),
	CONSTRAINT "chk_request_attempts_status" CHECK("status" in ('success', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE `request_attributes` (
	`key` text NOT NULL,
	`value` text NOT NULL,
	`requestId` text NOT NULL,
	`createdTime` integer NOT NULL,
	CONSTRAINT `request_attributes_pk` PRIMARY KEY(`requestId`, `key`),
	CONSTRAINT `fk_request_attributes_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`)
);
--> statement-breakpoint
CREATE TABLE `request_contents` (
	`id` text PRIMARY KEY,
	`requestId` text NOT NULL,
	`captureStatus` text NOT NULL,
	`requestMethod` text NOT NULL,
	`requestPath` text NOT NULL,
	`requestHeaders` text,
	`requestBody` text,
	`responseStatus` integer,
	`responseHeaders` text,
	`responseBody` text,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	CONSTRAINT `fk_request_contents_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`),
	CONSTRAINT "chk_request_contents_capture_status" CHECK("captureStatus" in ('captured', 'partial'))
);
--> statement-breakpoint
CREATE TABLE `request_logs` (
	`id` text PRIMARY KEY,
	`status` text NOT NULL,
	`transport` text DEFAULT 'http' NOT NULL,
	`clientProtocol` text,
	`logicalModelId` text,
	`totalDurationMilliseconds` integer DEFAULT 0 NOT NULL,
	`createdTime` integer NOT NULL,
	CONSTRAINT "chk_request_logs_status" CHECK("status" in ('pending', 'success', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE `request_rewrite_rules` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`scope` text DEFAULT 'model' NOT NULL,
	`schemaVersion` integer DEFAULT 1 NOT NULL,
	`source` text DEFAULT 'user' NOT NULL,
	`match` text NOT NULL,
	`actions` text NOT NULL,
	`testCases` text DEFAULT '[]' NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
);
--> statement-breakpoint
CREATE TABLE `request_usages` (
	`type` text NOT NULL,
	`value` real,
	`rawValue` text,
	`requestId` text NOT NULL,
	`createdTime` integer NOT NULL,
	CONSTRAINT `request_usages_pk` PRIMARY KEY(`requestId`, `type`),
	CONSTRAINT `fk_request_usages_requestId_request_logs_id_fk` FOREIGN KEY (`requestId`) REFERENCES `request_logs`(`id`),
	CONSTRAINT "chk_request_usages_type" CHECK("type" in ('inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheCreationInputTokens', 'reasoningTokens', 'raw')),
	CONSTRAINT "chk_request_usages_value_shape" CHECK(("type" = 'raw' and "value" is null and "rawValue" is not null) or ("type" <> 'raw' and "value" is not null and "rawValue" is null))
);
--> statement-breakpoint
CREATE TABLE `runtime_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scheduling_policies` (
	`weight` integer DEFAULT 100 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`strategy` text DEFAULT 'priority' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`logicalModelId` text NOT NULL,
	`providerModelId` text NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer,
	CONSTRAINT `scheduling_policies_pk` PRIMARY KEY(`logicalModelId`, `providerModelId`),
	CONSTRAINT `fk_scheduling_policies_logicalModelId_logical_models_id_fk` FOREIGN KEY (`logicalModelId`) REFERENCES `logical_models`(`id`),
	CONSTRAINT `fk_scheduling_policies_providerModelId_provider_models_id_fk` FOREIGN KEY (`providerModelId`) REFERENCES `provider_models`(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL,
	`valueType` text DEFAULT 'string' NOT NULL,
	`updatedTime` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`version` integer NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`definition` text NOT NULL,
	`createdTime` integer NOT NULL,
	`updatedTime` integer NOT NULL,
	`deletedTime` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_attempt_contents_attempt` ON `attempt_contents` (`attemptId`);--> statement-breakpoint
CREATE INDEX `idx_attempt_usages_created_time` ON `attempt_usages` (`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_logical_models_enabled` ON `logical_models` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_logical_models_deleted_time` ON `logical_models` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_protocol_converters_unique_active` ON `protocol_converters` (`providerModelEndpointId`,`clientProtocol`) WHERE deletedTime IS NULL;--> statement-breakpoint
CREATE INDEX `idx_protocol_converters_protocol` ON `protocol_converters` (`clientProtocol`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_protocol_converters_deleted_time` ON `protocol_converters` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_endpoints_provider_protocol_active` ON `provider_endpoints` (`providerId`,`protocol`) WHERE deletedTime IS NULL;--> statement-breakpoint
CREATE INDEX `idx_provider_endpoints_protocol` ON `provider_endpoints` (`protocol`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_provider_endpoints_deleted_time` ON `provider_endpoints` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_model_endpoints_unique_active` ON `provider_model_endpoints` (`providerModelId`,`providerEndpointId`) WHERE deletedTime IS NULL;--> statement-breakpoint
CREATE INDEX `idx_provider_model_endpoints_provider_endpoint` ON `provider_model_endpoints` (`providerEndpointId`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_provider_model_endpoints_deleted_time` ON `provider_model_endpoints` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_model_request_rewrite_rule_priority_active` ON `provider_model_request_rewrite_rules` (`providerModelId`,`priority`) WHERE deletedTime IS NULL;--> statement-breakpoint
CREATE INDEX `idx_provider_model_request_rewrite_rules_deleted_time` ON `provider_model_request_rewrite_rules` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_provider_models_provider_model_active` ON `provider_models` (`providerId`,`modelName`) WHERE deletedTime IS NULL;--> statement-breakpoint
CREATE INDEX `idx_provider_models_enabled` ON `provider_models` (`providerId`,`enabled`,`deletedTime`);--> statement-breakpoint
CREATE INDEX `idx_provider_settings_key` ON `provider_settings` (`key`);--> statement-breakpoint
CREATE INDEX `idx_providers_enabled` ON `providers` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_providers_deleted_time` ON `providers` (`deletedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_request_attempts_request_order` ON `request_attempts` (`requestId`,`attemptIndex`);--> statement-breakpoint
CREATE INDEX `idx_request_attempts_created_time` ON `request_attempts` (`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_attempts_provider_time` ON `request_attempts` (`providerId`,`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_attempts_model_time` ON `request_attempts` (`providerModelId`,`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_attributes_key_value` ON `request_attributes` (`key`,`value`);--> statement-breakpoint
CREATE INDEX `idx_request_attributes_created_time` ON `request_attributes` (`createdTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_request_contents_request` ON `request_contents` (`requestId`);--> statement-breakpoint
CREATE INDEX `idx_request_logs_created_time` ON `request_logs` (`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_logs_status_created_time` ON `request_logs` (`status`,`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_request_logs_logical_model` ON `request_logs` (`logicalModelId`);--> statement-breakpoint
CREATE INDEX `idx_request_logs_client_protocol` ON `request_logs` (`clientProtocol`);--> statement-breakpoint
CREATE INDEX `idx_request_rewrite_rules_enabled` ON `request_rewrite_rules` (`enabled`);--> statement-breakpoint
CREATE INDEX `idx_request_rewrite_rules_scope` ON `request_rewrite_rules` (`scope`);--> statement-breakpoint
CREATE INDEX `idx_request_rewrite_rules_deleted_time` ON `request_rewrite_rules` (`deletedTime`);--> statement-breakpoint
CREATE INDEX `idx_request_usages_created_time` ON `request_usages` (`createdTime`);--> statement-breakpoint
CREATE INDEX `idx_runtime_logs_timestamp` ON `runtime_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_runtime_logs_level_timestamp` ON `runtime_logs` (`level`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_scheduling_policies_route` ON `scheduling_policies` (`logicalModelId`,`enabled`,`priority`,`weight`);--> statement-breakpoint
CREATE INDEX `idx_scheduling_policies_deleted_time` ON `scheduling_policies` (`deletedTime`);--> statement-breakpoint
CREATE INDEX `idx_settings_updated_time` ON `settings` (`updatedTime`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_workflows_type_version` ON `workflows` (`type`,`version`);--> statement-breakpoint
CREATE INDEX `idx_workflows_type` ON `workflows` (`type`,`deletedTime`);--> statement-breakpoint
CREATE INDEX `idx_workflows_deleted_time` ON `workflows` (`deletedTime`);
