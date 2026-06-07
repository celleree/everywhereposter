import {
  AgentToolInterface,
} from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class IntegrationListTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationList';

  run() {
    return createTool({
      id: 'integrationList',
      description: `This tool list available integrations to schedule posts to`,
      inputSchema: z.object({}),
      mcp: {
        annotations: {
          title: 'List Integrations',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        output: z.array(
          z.object({
            number: z.number(),
            option: z.string(),
            id: z.string(),
            name: z.string(),
            picture: z.string(),
            platform: z.string(),
            platformLabel: z.string(),
            display: z.string().nullable(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        return {
          output: (
            await this._integrationService.getIntegrationsList(organizationId)
          ).map((p, index) => {
            const number = index + 1;
            const platformLabel = (
              p.providerIdentifier.split('-')[0] || 'Channel'
            )
              .split(/[\s_]+/)
              .filter(Boolean)
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(' ');
            const display = p.profile || null;
            const accountName = p.name || display || '';

            return {
              number,
              option: `${number}. ${platformLabel}${
                accountName ? `: ${accountName}` : ''
              }`,
              name: p.name,
              id: p.id,
              disabled: p.disabled,
              picture: p.picture || '/no-picture.jpg',
              platform: p.providerIdentifier,
              platformLabel,
              display,
              type: p.type,
            };
          }),
        };
      },
    });
  }
}
