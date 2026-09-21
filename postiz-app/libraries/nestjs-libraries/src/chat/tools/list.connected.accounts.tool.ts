import { createTool } from '@mastra/core/tools';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { getAuth } from '@gitroom/nestjs-libraries/chat/async.storage';
import z from 'zod';

const accountStatus = z.enum([
  'connected',
  'disabled',
  'reconnection_required',
  'setup_pending',
]);

export const createListConnectedAccountsTool = (
  integrationService: Pick<IntegrationService, 'getIntegrationsList'>
) =>
  createTool({
    id: 'list_connected_accounts',
    description:
      'List the social accounts connected to the organization authorized by this OAuth grant.',
    inputSchema: z.object({}).strict(),
    mcp: {
      annotations: {
        title: 'List connected accounts',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    outputSchema: z.object({
      accounts: z.array(
        z.object({
          id: z.string(),
          platform: z.string(),
          displayName: z.string(),
          profile: z.string().nullable(),
          picture: z.string().nullable(),
          status: accountStatus,
          usable: z.boolean(),
          disabled: z.boolean(),
          requiresReconnection: z.boolean(),
          setupPending: z.boolean(),
        })
      ),
    }),
    execute: async () => {
      const organization = getAuth<{ id: string }>();
      if (!organization?.id) {
        throw new Error('Authenticated organization context is required');
      }

      const integrations = await integrationService.getIntegrationsList(
        organization.id
      );

      return {
        accounts: integrations.map((integration) => {
          const disabled = integration.disabled;
          const requiresReconnection = integration.refreshNeeded;
          const setupPending = integration.inBetweenSteps;
          const usable = !disabled && !requiresReconnection && !setupPending;
          const status = setupPending
            ? 'setup_pending'
            : requiresReconnection
            ? 'reconnection_required'
            : disabled
            ? 'disabled'
            : 'connected';

          return {
            id: integration.id,
            platform: integration.providerIdentifier,
            displayName: integration.name,
            profile: integration.profile || null,
            picture: integration.picture || null,
            status,
            usable,
            disabled,
            requiresReconnection,
            setupPending,
          };
        }),
      };
    },
  });
