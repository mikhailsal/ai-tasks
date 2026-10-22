CREATE TABLE `pagination_secrets` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`secret` text NOT NULL,
	CONSTRAINT "pagination_secret_singleton" CHECK("pagination_secrets"."id" = 1),
	CONSTRAINT "pagination_secret_hex256" CHECK(typeof("pagination_secrets"."secret") = 'text' AND instr("pagination_secrets"."secret", char(0)) = 0 AND length("pagination_secrets"."secret") = 64 AND "pagination_secrets"."secret" NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
INSERT INTO `pagination_secrets` (`id`, `secret`) VALUES (1, lower(hex(randomblob(32))));
