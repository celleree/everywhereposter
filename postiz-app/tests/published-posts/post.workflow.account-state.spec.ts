const getPostsList = jest.fn();
const inAppNotification = jest.fn();
const changeState = jest.fn();
const updatePost = jest.fn();
const sendWebhooks = jest.fn();
const isCommentable = jest.fn();
const postSocial = jest.fn();
const postComment = jest.fn();
const getIntegrationById = jest.fn();
const refreshTokenWithCause = jest.fn();
const internalPlugs = jest.fn();
const globalPlugs = jest.fn();
const processInternalPlug = jest.fn();
const processPlug = jest.fn();
const patched = jest.fn(() => true);
const sleep = jest.fn().mockResolvedValue(undefined);

jest.mock('@temporalio/workflow', () => ({
  ActivityFailure: class ActivityFailure extends Error {},
  ApplicationFailure: class ApplicationFailure extends Error {},
  defineSignal: jest.fn(() => 'poke'),
  patched,
  proxyActivities: (options: { taskQueue?: string }) =>
    options.taskQueue
      ? {
          postSocial,
          postComment,
          getIntegrationById,
          refreshTokenWithCause,
          internalPlugs,
          globalPlugs,
          processInternalPlug,
          processPlug,
        }
      : {
          getPostsList,
          inAppNotification,
          changeState,
          updatePost,
          sendWebhooks,
          isCommentable,
        },
  setHandler: jest.fn(),
  sleep,
  startChild: jest.fn(),
}));

import { postWorkflowV102 } from '@gitroom/orchestrator/workflows/post-workflows/post.workflow.v1.0.2';

const patchId = 'post-workflow-v102-persist-unusable-account-error';
const baseIntegration = {
  id: 'integration-1',
  organizationId: 'org-1',
  providerIdentifier: 'youtube',
  name: 'Creator channel',
  disabled: false,
  inBetweenSteps: false,
  refreshNeeded: false,
};

const setPostIntegrationState = (integrationOverrides: Record<string, any>) => {
  const posts = [
    {
      id: 'post-1',
      state: 'QUEUE',
      publishDate: '2020-01-01T00:00:00.000Z',
      organizationId: 'org-1',
      settings: '{}',
      integration: {
        ...baseIntegration,
        ...integrationOverrides,
      },
    },
  ];
  getPostsList.mockResolvedValue(posts);
  return posts;
};

const runWorkflow = () =>
  postWorkflowV102({
    taskQueue: 'youtube',
    postId: 'post-1',
    organizationId: 'org-1',
  });

describe('postWorkflowV102 unusable account states', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    patched.mockReturnValue(true);
    sleep.mockResolvedValue(undefined);
    getIntegrationById.mockResolvedValue(baseIntegration);
    postSocial.mockResolvedValue([
      {
        postId: 'provider-post-1',
        releaseURL: 'https://youtube.example/post-1',
      },
    ]);
    updatePost.mockResolvedValue(undefined);
    inAppNotification.mockResolvedValue(undefined);
    sendWebhooks.mockResolvedValue(undefined);
    internalPlugs.mockResolvedValue([]);
    globalPlugs.mockResolvedValue([]);
  });

  it.each([
    [
      'reconnect-required',
      { refreshNeeded: true },
      'Reconnect this account before publishing.',
    ],
    [
      'disabled',
      { disabled: true },
      'This account is disabled and cannot publish.',
    ],
    [
      'in-between',
      { inBetweenSteps: true },
      'Finish connecting this account before publishing.',
    ],
  ])(
    'records a terminal ERROR when a usable account becomes %s after sleeping',
    async (_label, integrationOverrides, expectedError) => {
      const posts = setPostIntegrationState({});
      getIntegrationById.mockResolvedValue({
        ...baseIntegration,
        ...integrationOverrides,
      });

      await runWorkflow();

      expect(patched).toHaveBeenCalledWith(patchId);
      expect(getIntegrationById).toHaveBeenCalledWith(
        'org-1',
        'integration-1'
      );
      expect(sleep.mock.invocationCallOrder[0]).toBeLessThan(
        getIntegrationById.mock.invocationCallOrder[0]
      );
      expect(changeState).toHaveBeenCalledWith(
        'post-1',
        'ERROR',
        expectedError,
        posts
      );
      expect(inAppNotification).toHaveBeenCalledTimes(1);
      expect(postSocial).not.toHaveBeenCalled();
      expect(postComment).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['missing', undefined],
    [
      'deleted',
      {
        ...baseIntegration,
        deletedAt: new Date('2030-01-01T00:00:00.000Z'),
      },
    ],
  ])(
    'records a terminal ERROR when the account becomes %s after sleeping',
    async (_label, currentIntegration) => {
      const posts = setPostIntegrationState({});
      getIntegrationById.mockResolvedValue(currentIntegration);

      await runWorkflow();

      expect(changeState).toHaveBeenCalledWith(
        'post-1',
        'ERROR',
        'This account is unavailable and cannot publish.',
        posts
      );
      expect(inAppNotification).not.toHaveBeenCalled();
      expect(postSocial).not.toHaveBeenCalled();
      expect(postComment).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['reconnect-required', { refreshNeeded: true }],
    ['disabled', { disabled: true }],
  ])(
    'preserves the legacy notification-only exit for a %s account',
    async (_label, integrationOverrides) => {
      patched.mockReturnValue(false);
      setPostIntegrationState(integrationOverrides);

      await runWorkflow();

      expect(patched).toHaveBeenCalledWith(patchId);
      expect(getIntegrationById).not.toHaveBeenCalled();
      expect(changeState).not.toHaveBeenCalled();
      expect(inAppNotification).toHaveBeenCalledTimes(1);
      expect(postSocial).not.toHaveBeenCalled();
      expect(postComment).not.toHaveBeenCalled();
    }
  );

  it('preserves legacy continuation for an in-between account', async () => {
    patched.mockReturnValue(false);
    setPostIntegrationState({ inBetweenSteps: true });

    await runWorkflow();

    expect(patched).toHaveBeenCalledWith(patchId);
    expect(getIntegrationById).not.toHaveBeenCalled();
    expect(changeState).not.toHaveBeenCalled();
    expect(postSocial).toHaveBeenCalledTimes(1);
    expect(postSocial).toHaveBeenCalledWith(
      expect.objectContaining({ inBetweenSteps: true }),
      [expect.objectContaining({ id: 'post-1' })]
    );
    expect(updatePost).toHaveBeenCalledWith(
      'post-1',
      'provider-post-1',
      'https://youtube.example/post-1'
    );
  });
});
