'use client';

import React, {
  createContext,
  createRef,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import type { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import { useLaunchStore } from './store';
import {
  useGuidedComposerStore,
  CAPTION_MODES,
  GUIDED_COMPOSER_STEPS,
} from './guided.composer.store';

export const INTERRUPTED_GENERATION =
  'Caption generation was interrupted. Your saved edits are retained. Continue when you are ready to try again.';
const STORAGE_PREFIX = 'everywhereposter:create-draft:v1:';
const MAX_BYTES = 1_000_000;
const resetComposerState = () => {
  useLaunchStore.getState().reset();
  useLaunchStore.setState({ repeater: undefined });
  useGuidedComposerStore.getState().resetGuidedComposer();
};
const GUIDED_FIELDS = [
  'composerStep',
  'sourceMediaId',
  'transcriptionStatus',
  'transcriptionError',
  'additionalContext',
  'captionMode',
  'sourceCaption',
  'generationStatus',
  'generatedResponse',
  'generationError',
  'generationInputFingerprint',
  'reviewDrafts',
] as const;
type GuidedState = ReturnType<typeof useGuidedComposerStore.getState>;
type Values = ReturnType<typeof useLaunchStore.getState>['global'];
type StoredValues = Array<{
  id: string;
  content: string;
  delay: number;
  media: Array<{ id: string; alt?: string; thumbnailTimestamp?: number }>;
}>;
type Journal = {
  destinationIds: string[];
  startedAt: number;
  attemptId: string;
  durableImmediate?: true;
};
type SubmissionStatus = {
  submissionId: string;
  destinations: Array<{ integrationId: string; postId: string; generation: number;
    state: string; providerState: string; postState: string; workflowState: string; recoverability: string }>;
};
const submissionLabels: Record<string, string> = {
  unavailable: 'Unavailable', uncertain: 'Outcome unconfirmed', published: 'Published',
  'reconnect-required': 'Reconnect account', 'failed-before-provider': 'Stopped before publishing',
  failed: 'Needs review', processing: 'Processing',
};
export function readSubmissionStatus(value: any, journal: Journal): SubmissionStatus {
  const ids = new Set(journal.destinationIds);
  if (!value || value.submissionId !== journal.attemptId || !Array.isArray(value.destinations) ||
      value.destinations.length !== ids.size || !ids.size ||
      new Set(value.destinations.map((item: any) => item?.postId)).size !== ids.size ||
      !value.destinations.every((item: any) => item && ids.delete(item.integrationId) &&
        typeof item.postId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(item.postId) &&
        Number.isSafeInteger(item.generation) && item.generation > 0 &&
        ['READY', 'IN_FLIGHT', 'UNCERTAIN', 'SUCCEEDED'].includes(item.providerState) &&
        typeof item.postState === 'string' && typeof item.workflowState === 'string' &&
        ['unavailable', 'uncertain', 'published', 'reconnect-required', 'failed-before-provider', 'failed', 'processing'].includes(item.state) &&
        (item.recoverability === 'locked' ||
          (item.recoverability === 'complete' && item.state === 'published' && item.providerState === 'SUCCEEDED' && item.postState === 'PUBLISHED') ||
          (item.providerState === 'READY' &&
            ((item.recoverability === 'resume-dispatch' && item.state === 'processing' && item.postState === 'QUEUE') ||
             (item.recoverability === 'retry-before-provider' && item.state === 'failed-before-provider' &&
              ['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED', 'TIMED_OUT'].includes(item.workflowState))))))) {
    throw new Error('The publishing status could not be verified. Your attempt remains locked.');
  }
  return value;
}
export type ComposerDraft = {
  version: 1;
  userId: string;
  orgId: string;
  savedAt: number;
  global: StoredValues;
  internal: Array<{
    destinationId: string;
    integrationValue: StoredValues;
    inheritRootMedia: boolean;
  }>;
  destinations: Array<{ id: string; settings: Record<string, unknown> }>;
  current: string;
  date: string;
  repeater: number | null;
  tags: Array<{ label: string; value: string }>;
  guided: Pick<GuidedState, (typeof GUIDED_FIELDS)[number]> & {
    unsupportedDestinationIds: string[];
  };
  timing: 'now' | 'schedule';
  journal: Journal | null;
};

// Draft data is JSON, never a serialized user, integration, file, ref or provider cache.
export function draftJson(value: unknown, depth = 0): any {
  if (depth > 12) throw new Error('Draft settings are too deeply nested.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 100_000)
      throw new Error('Draft text is too large to recover.');
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= 100)
    return value.map((item) => draftJson(item, depth + 1));
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, item]) =>
            !/(__proto__|constructor|prototype|password|secret|token|credential|authorization|api.?key)/i.test(
              key
            ) && item !== undefined
        )
        .map(([key, item]) => [key, draftJson(item, depth + 1)])
    );
  }
  throw new Error('This draft contains an unsupported value.');
}
const storedValues = (values: Values): StoredValues =>
  values.map((value) => ({
    id: value.id,
    content: value.content,
    delay: value.delay || 0,
    media: value.media.map((media) => {
      const editable = media as typeof media & {
        alt?: string | null;
        thumbnailTimestamp?: number | null;
      };
      return {
        id: media.id,
        ...(editable.alt != null ? { alt: editable.alt } : {}),
        ...(editable.thumbnailTimestamp != null
          ? { thumbnailTimestamp: editable.thumbnailTimestamp }
          : {}),
      };
    }),
  }));
export const composerDraftKey = (userId: string, orgId: string) =>
  `${STORAGE_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(orgId)}`;
export function snapshotComposerDraft(
  userId: string,
  orgId: string,
  timing: ComposerDraft['timing'],
  journal: Journal | null
): ComposerDraft {
  const launch = useLaunchStore.getState();
  const guided = useGuidedComposerStore.getState();
  return draftJson({
    version: 1,
    userId,
    orgId,
    savedAt: Date.now(),
    global: storedValues(launch.global),
    internal: launch.internal.map((item) => ({
      destinationId: item.integration.id,
      integrationValue: storedValues(item.integrationValue),
      inheritRootMedia: !!item.inheritRootMedia,
    })),
    destinations: launch.selectedIntegrations.map((item) => ({
      id: item.integration.id,
      settings: item.settings,
    })),
    current: launch.current,
    date: launch.date.toISOString(),
    repeater: launch.repeater ?? null,
    tags: launch.tags,
    guided: {
      ...Object.fromEntries(
        GUIDED_FIELDS.map((field) => [field, guided[field]])
      ),
      unsupportedDestinationIds: guided.unsupportedDestinations.map(
        ({ id }) => id
      ),
    },
    timing,
    journal,
  });
}
function requireDraft(condition: unknown): asserts condition {
  if (!condition)
    throw new Error(
      'The saved composer draft could not be read. It has been kept for recovery.'
    );
}
export function readComposerDraft(
  raw: string,
  userId: string,
  orgId: string
): ComposerDraft {
  requireDraft(raw.length <= MAX_BYTES);
  const draft = draftJson(JSON.parse(raw));
  requireDraft(
    draft &&
      draft.version === 1 &&
      draft.userId === userId &&
      draft.orgId === orgId &&
      Number.isFinite(draft.savedAt)
  );
  const valuesValid = (values: any) =>
    Array.isArray(values) &&
    values.length <= 100 &&
    values.every(
      (value: any) =>
        value &&
        typeof value.id === 'string' &&
        typeof value.content === 'string' &&
        Number.isFinite(value.delay) &&
        value.delay >= 0 &&
        Array.isArray(value.media) &&
        value.media.every(
          (media: any) =>
            media &&
            typeof media.id === 'string' &&
            /^[a-zA-Z0-9_-]{1,128}$/.test(media.id) &&
            (media.alt == null || typeof media.alt === 'string') &&
            (media.thumbnailTimestamp == null ||
              (Number.isFinite(media.thumbnailTimestamp) &&
                media.thumbnailTimestamp >= 0))
        )
    );
  requireDraft(
    valuesValid(draft.global) &&
      draft.global.length > 0 &&
      Array.isArray(draft.internal) &&
      draft.internal.every(
        (item: any) =>
          item &&
          typeof item.destinationId === 'string' &&
          typeof item.inheritRootMedia === 'boolean' &&
          valuesValid(item.integrationValue)
      )
  );
  requireDraft(
    Array.isArray(draft.destinations) &&
      draft.destinations.every(
        (item: any) =>
          item &&
          typeof item.id === 'string' &&
          item.settings &&
          !Array.isArray(item.settings) &&
          typeof item.settings === 'object'
      )
  );
  requireDraft(
    typeof draft.current === 'string' &&
      typeof draft.date === 'string' &&
      dayjs(draft.date).isValid() &&
      (draft.repeater === null || Number.isFinite(draft.repeater))
  );
  requireDraft(
    Array.isArray(draft.tags) &&
      draft.tags.every(
        (item: any) =>
          item &&
          typeof item.label === 'string' &&
          typeof item.value === 'string'
      )
  );
  const guided = draft.guided;
  requireDraft(
    guided &&
      GUIDED_COMPOSER_STEPS.includes(guided.composerStep) &&
      CAPTION_MODES.includes(guided.captionMode)
  );
  requireDraft(
    ['additionalContext', 'sourceCaption'].every(
      (key) => typeof guided[key] === 'string'
    ) &&
      (guided.sourceMediaId === null ||
        typeof guided.sourceMediaId === 'string')
  );
  requireDraft(
    ['IDLE', 'PENDING', 'PROCESSING', 'READY', 'FAILED'].includes(
      guided.transcriptionStatus
    ) &&
      ['idle', 'loading', 'complete', 'partial', 'failed'].includes(
        guided.generationStatus
      )
  );
  requireDraft(
    [
      'transcriptionError',
      'generationError',
      'generationInputFingerprint',
    ].every((key) => guided[key] === null || typeof guided[key] === 'string')
  );
  const warningsValid = (warnings: any) =>
    Array.isArray(warnings) &&
    warnings.every(
      (warning: any) =>
        warning &&
        typeof warning.code === 'string' &&
        typeof warning.message === 'string'
    );
  requireDraft(
    guided.generatedResponse === null ||
      (guided.generatedResponse &&
        Array.isArray(guided.generatedResponse.results) &&
        warningsValid(guided.generatedResponse.warnings) &&
        typeof guided.generatedResponse.requestId === 'string' &&
        ['complete', 'partial', 'failed'].includes(
          guided.generatedResponse.status
        ) &&
        guided.generatedResponse.results.every(
          (result: any) =>
            result &&
            typeof result.platform === 'string' &&
            typeof result.draft === 'string' &&
            ['generated', 'original', 'adapted'].includes(result.origin) &&
            warningsValid(result.warnings)
        ))
  );
  requireDraft(
    Array.isArray(guided.unsupportedDestinationIds) &&
      guided.unsupportedDestinationIds.every(
        (id: unknown) => typeof id === 'string'
      )
  );
  requireDraft(
    guided.reviewDrafts &&
      !Array.isArray(guided.reviewDrafts) &&
      Object.values(guided.reviewDrafts).every(
        (item: any) =>
          item &&
          [
            'destinationId',
            'caption',
            'baselineCaption',
            'originalCaption',
            'sourceFingerprint',
          ].every((key) => typeof item[key] === 'string') &&
          typeof item.enabled === 'boolean' &&
          warningsValid(item.warnings) &&
          ['generated', 'original', 'adapted'].includes(item.baselineSource) &&
          ['generated', 'original', 'adapted', 'edited'].includes(item.source)
      )
  );
  requireDraft(
    ['now', 'schedule'].includes(draft.timing) &&
      (draft.journal === null ||
        (draft.journal &&
          Number.isFinite(draft.journal.startedAt) &&
          typeof draft.journal.attemptId === 'string' &&
          (draft.journal.durableImmediate === undefined ||
            (draft.journal.durableImmediate === true && draft.timing === 'now' &&
              /^[a-zA-Z0-9_-]{16,128}$/.test(draft.journal.attemptId))) &&
          Array.isArray(draft.journal.destinationIds) &&
          draft.journal.destinationIds.every(
            (id: unknown) => typeof id === 'string'
          )))
  );
  // Only the validated envelope fields cross the persistence boundary.
  return {
    version: draft.version,
    userId: draft.userId,
    orgId: draft.orgId,
    savedAt: draft.savedAt,
    global: storedValues(draft.global),
    internal: draft.internal.map((item: any) => ({
      destinationId: item.destinationId,
      integrationValue: storedValues(item.integrationValue),
      inheritRootMedia: item.inheritRootMedia,
    })),
    destinations: draft.destinations.map((item: any) => ({
      id: item.id,
      settings: item.settings,
    })),
    current: draft.current,
    date: draft.date,
    repeater: draft.repeater,
    tags: draft.tags.map(({ label, value }: any) => ({ label, value })),
    timing: draft.timing,
    journal: draft.journal && {
      startedAt: draft.journal.startedAt,
      attemptId: draft.journal.attemptId,
      destinationIds: draft.journal.destinationIds,
      ...(draft.journal.durableImmediate ? { durableImmediate: true } : {}),
    },
    guided: {
      ...Object.fromEntries(
        GUIDED_FIELDS.map((field) => [field, guided[field]])
      ),
      unsupportedDestinationIds: guided.unsupportedDestinationIds,
    },
  } as ComposerDraft;
}
export async function hydrateComposerDraft(
  draft: ComposerDraft,
  integrations: Integrations[],
  fetcher: ReturnType<typeof useFetch>,
  canCommit = () => true
) {
  const byId = new Map(
    integrations.map((integration) => [integration.id, integration])
  );
  if (
    !draft.destinations.every(({ id }) => {
      const integration = byId.get(id);
      return (
        integration && !integration.disabled && !integration.inBetweenSteps
      );
    }) ||
    !draft.internal.every((item) => byId.has(item.destinationId))
  )
    throw new Error(
      'Some saved destinations are unavailable. Your captions and settings are still saved. Reconnect the accounts and retry recovery.'
    );
  const mediaIds = [
    ...new Set(
      [
        ...draft.global,
        ...draft.internal.flatMap((item) => item.integrationValue),
      ].flatMap((value) => value.media.map(({ id }) => id))
    ),
  ];
  const media = new Map(
    await Promise.all(
      mediaIds.map(async (id) => {
        const response = await fetcher(`/media/${encodeURIComponent(id)}`, {
          method: 'GET',
        });
        const item = response.ok ? await response.json() : null;
        if (
          !item ||
          item.id !== id ||
          typeof item.path !== 'string' ||
          !item.path ||
          /^(blob:|data:|file:)/i.test(item.path)
        )
          throw new Error(
            'Some saved media is unavailable. Your captions and settings are still saved. Retry recovery when the media is available.'
          );
        return [
          id,
          {
            id,
            path: item.path,
            type: item.type,
            originalName: item.originalName,
            thumbnail: item.thumbnail,
          },
        ] as const;
      })
    )
  );
  if (!canCommit()) return;
  const values = (stored: StoredValues): Values =>
    stored.map((value) => ({
      ...value,
      media: value.media.map((item) => ({ ...media.get(item.id)!, ...item })),
    }));
  const interrupted = draft.guided.generationStatus === 'loading';
  useLaunchStore.setState({
    integrations,
    global: values(draft.global),
    internal: draft.internal.map((item) => ({
      integration: byId.get(item.destinationId)!,
      integrationValue: values(item.integrationValue),
      inheritRootMedia: item.inheritRootMedia,
    })),
    selectedIntegrations: draft.destinations.map((item) => ({
      integration: byId.get(item.id)!,
      settings: item.settings,
      ref: createRef(),
    })),
    current: byId.has(draft.current) ? draft.current : 'global',
    date: dayjs(draft.date),
    tags: draft.tags,
    repeater: draft.repeater ?? undefined,
  });
  const { unsupportedDestinationIds, ...guidedValues } = draft.guided;
  useGuidedComposerStore.setState({
    ...guidedValues,
    generationStatus: interrupted ? 'failed' : draft.guided.generationStatus,
    generationError: interrupted
      ? INTERRUPTED_GENERATION
      : draft.guided.generationError,
    generationProgress: '',
    unsupportedDestinations: draft.guided.unsupportedDestinationIds
      .map((id) => byId.get(id))
      .filter((item): item is Integrations => !!item),
    transcriptionStatus: draft.guided.sourceMediaId ? 'PROCESSING' : 'IDLE',
    reviewDrafts: Object.fromEntries(
      Object.entries(draft.guided.reviewDrafts).map(([id, item]) => [
        id,
        {
          ...item,
          regenerationStatus: 'idle',
          regenerationRequestToken: null,
          regenerationError: null,
        },
      ])
    ),
  });
}

type Recovery = {
  active: boolean;
  restored: boolean;
  restoredSourceId: string | null;
  publishLocked: boolean;
  timing: ComposerDraft['timing'];
  setTiming: (timing: ComposerDraft['timing']) => void;
  prepareSubmission: (destinationIds: string[]) => boolean;
  beginSubmission: (destinationIds: string[]) => boolean;
  beginImmediateSubmission: (destinationIds: string[]) => Promise<string | null>;
  checkImmediateSubmission: () => Promise<void>;
  isImmediateSubmissionCurrent: (id: string) => boolean;
  safeSubmissionFailure: () => void;
  settingsSaveFailed: () => void;
  savedDraftComplete: () => void;
};
const RecoveryContext = createContext<Recovery>({
  active: false,
  restored: false,
  restoredSourceId: null,
  publishLocked: false,
  timing: 'now',
  setTiming: () => {},
  prepareSubmission: () => true,
  beginSubmission: () => true,
  beginImmediateSubmission: async () => null,
  checkImmediateSubmission: async () => {},
  isImmediateSubmissionCurrent: () => false,
  safeSubmissionFailure: () => {},
  settingsSaveFailed: () => {},
  savedDraftComplete: () => {},
});
export const useComposerDraftRecovery = () => useContext(RecoveryContext);

export function ComposerDraftRecovery({
  integrations,
  children,
}: {
  integrations: Integrations[];
  children: ReactNode;
}) {
  const user = useUser();
  const fetcher = useFetch();
  const scope =
    user?.id && user?.orgId ? composerDraftKey(user.id, user.orgId) : '';
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const latest = useRef({ integrations, fetcher, user });
  latest.current = { integrations, fetcher, user };
  const [phase, setPhase] = useState<'loading' | 'ready' | 'blocked'>(
    'loading'
  );
  const [ownPostStarted, setOwnPostStarted] = useState(false);
  const ownPostStartedRef = useRef(false);
  const [foreignLock, setForeignLock] = useState(false);
  const foreignLockRef = useRef(false);
  const [message, setMessage] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [restored, setRestored] = useState<ComposerDraft | null>(null);
  const [timing, setTiming] = useState<ComposerDraft['timing']>('now');
  const timingRef = useRef(timing);
  timingRef.current = timing;
  const journalRef = useRef<Journal | null>(null);
  const readyRef = useRef(false);
  const readyScopeRef = useRef('');
  const completedRef = useRef(false);
  const saveRef = useRef<() => boolean>(() => false);
  const [submissionStatus, setSubmissionStatus] = useState<SubmissionStatus | null>(null);
  const [checkingSubmission, setCheckingSubmission] = useState(false);
  const statusRequest = useRef(0);
  const recoveryMutation = useRef(false);

  const checkImmediateSubmission = async (action?: 'resume' | string) => {
    const journal = journalRef.current;
    if (!scope || currentScope.current !== scope || readyScopeRef.current !== scope || !journal?.durableImmediate || recoveryMutation.current) return;
    // Only a current server classification can expose a recovery mutation.
    if (action && (!submissionStatus || submissionStatus.submissionId !== journal.attemptId ||
        !submissionStatus.destinations.some(item => action === 'resume'
          ? item.recoverability === 'resume-dispatch'
          : item.integrationId === action && item.recoverability === 'retry-before-provider'))) return;
    if (action) recoveryMutation.current = true;
    const request = ++statusRequest.current;
    const stillCurrent = () => currentScope.current === scope && request === statusRequest.current && journalRef.current?.attemptId === journal.attemptId;
    setCheckingSubmission(true);
    setSubmissionStatus(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const suffix = !action ? '' : action === 'resume' ? '/resume' : `/destinations/${encodeURIComponent(action)}/retry`;
      const response = await latest.current.fetcher(`/posts/submissions/${encodeURIComponent(journal.attemptId)}${suffix}`, { method: action ? 'POST' : 'GET', signal: controller.signal });
      if (!response.ok) throw new Error('Publishing status is unavailable. The original request may have been accepted; do not resend it.');
      const status = readSubmissionStatus(await response.json(), journal);
      if (stillCurrent()) { setSubmissionStatus(status); setMessage(''); }
    } catch {
      if (stillCurrent()) setMessage('Publishing status could not be confirmed. Your attempt remains locked; check status again before taking further action.');
    } finally {
      clearTimeout(timeout);
      if (stillCurrent()) setCheckingSubmission(false);
      if (action) recoveryMutation.current = false;
    }
  };

  useEffect(() => {
    let active = true;
    readyRef.current = false;
    readyScopeRef.current = '';
    setPhase('loading');
    setAcknowledged(false);
    setRestored(null);
    setSubmissionStatus(null);
    setCheckingSubmission(false);
    statusRequest.current++;
    completedRef.current = false;
    journalRef.current = null;
    ownPostStartedRef.current = false;
    setOwnPostStarted(false);
    foreignLockRef.current = false;
    setForeignLock(false);
    (async () => {
      try {
        if (!scope) {
          if (active) setPhase('ready');
          return;
        }
        const raw = localStorage.getItem(scope);
        if (raw) {
          const {
            user: identity,
            integrations: channels,
            fetcher: get,
          } = latest.current;
          const draft = readComposerDraft(raw, identity!.id, identity!.orgId);
          await hydrateComposerDraft(draft, channels, get, () => active);
          if (!active) return;
          journalRef.current = draft.journal;
          setTiming(draft.timing);
          setRestored(draft);
        } else if (active) {
          resetComposerState();
          setTiming('now');
        }
        if (active) {
          setMessage('');
          setPhase('ready');
        }
      } catch (error) {
        if (active) {
          setMessage(
            error instanceof Error
              ? error.message
              : 'Draft recovery failed. Your saved work has been kept.'
          );
          setPhase('blocked');
        }
      }
    })();
    return () => {
      active = false;
      readyRef.current = false;
    };
  }, [scope, attempt]);

  const adoptJournal = () => {
    if (!scope) return false;
    const raw = localStorage.getItem(scope);
    const identity = latest.current.user!;
    const stored = raw
      ? readComposerDraft(raw, identity.id, identity.orgId).journal
      : null;
    if (stored && stored.attemptId !== journalRef.current?.attemptId) {
      statusRequest.current++;
      setSubmissionStatus(null);
      setCheckingSubmission(false);
      journalRef.current = stored;
      foreignLockRef.current = true;
      setForeignLock(true);
    }
    return foreignLockRef.current;
  };
  useEffect(() => {
    if (phase !== 'ready' || !scope) return;
    readyRef.current = true;
    readyScopeRef.current = scope;
    const identity = latest.current.user!;
    const save = () => {
      if (!readyRef.current || !useLaunchStore.getState().global.length)
        return completedRef.current;
      try {
        adoptJournal();
        const raw = JSON.stringify(
          snapshotComposerDraft(
            identity.id,
            identity.orgId,
            timingRef.current,
            journalRef.current
          )
        );
        if (raw.length > MAX_BYTES)
          throw new Error('The composer draft is too large to recover.');
        localStorage.setItem(scope, raw);
        return true;
      } catch {
        setMessage(
          'Your draft cannot be saved in this browser. Keep this page open or save a draft before leaving.'
        );
        return false;
      }
    };
    saveRef.current = save;
    const stopLaunch = useLaunchStore.subscribe(save);
    const stopGuided = useGuidedComposerStore.subscribe(save);
    const leaving = (event: BeforeUnloadEvent) => {
      if (useLaunchStore.getState().locked || !save()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const navigate = (event: MouseEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest('a[href]')
      )
        return;
      if (
        (useLaunchStore.getState().locked || !save()) &&
        !window.confirm(
          'Some composer work cannot be recovered in this browser, including any upload still in progress. Leave this page?'
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === scope) {
        try {
          adoptJournal();
        } catch {
          setMessage(
            'Draft storage changed unexpectedly. Check Schedule before publishing.'
          );
        }
      }
    };
    window.addEventListener('storage', storageChanged);
    document.addEventListener('click', navigate, true);
    window.addEventListener('beforeunload', leaving);
    window.addEventListener('pagehide', save);
    save();
    return () => {
      save();
      readyRef.current = false;
      readyScopeRef.current = '';
      stopLaunch();
      stopGuided();
      window.removeEventListener('storage', storageChanged);
      document.removeEventListener('click', navigate, true);
      window.removeEventListener('beforeunload', leaving);
      window.removeEventListener('pagehide', save);
      resetComposerState();
    };
  }, [phase, scope]);

  useEffect(() => {
    if (phase === 'ready' && restored?.journal?.durableImmediate) void checkImmediateSubmission();
    return () => { statusRequest.current++; };
  }, [phase, scope, restored]);

  const prepareSubmission = (destinationIds: string[]) => {
    if (restored?.journal || !scope) return !restored?.journal;
    if (ownPostStartedRef.current) return false;
    try {
      if (adoptJournal()) return false;
    } catch {
      return false;
    }
    journalRef.current ||= {
      destinationIds,
      startedAt: Date.now(),
      attemptId: Array.from(
        crypto.getRandomValues(new Uint8Array(16)),
        (byte) => byte.toString(16).padStart(2, '0')
      ).join(''),
    };
    return saveRef.current() && !foreignLockRef.current;
  };
  const beginSubmission = (destinationIds: string[]) => {
    // Preparation may pass through validation; only the actual POST consumes it.
    // This ref also blocks a retry before React renders the visible lock.
    if (!prepareSubmission(destinationIds)) return false;
    ownPostStartedRef.current = true;
    setOwnPostStarted(true);
    return true;
  };
  const beginImmediateSubmission = async (destinationIds: string[]) => {
    if (!scope || currentScope.current !== scope || restored?.journal || ownPostStartedRef.current ||
        !readyRef.current || readyScopeRef.current !== scope || !navigator.locks?.request || !destinationIds.length ||
        new Set(destinationIds).size !== destinationIds.length) {
      setMessage('Publishing needs working browser storage and tab coordination. Keep this draft open and try again in a supported secure browser.');
      return null;
    }
    try {
      return await navigator.locks.request(`publishing:${scope}`, { ifAvailable: true }, async lock => {
        if (!lock || currentScope.current !== scope || readyScopeRef.current !== scope || ownPostStartedRef.current || !readyRef.current) return null;
        if (!prepareSubmission(destinationIds)) return null;
        const journal = journalRef.current!;
        if (journal.destinationIds.length !== destinationIds.length || !destinationIds.every(id => journal.destinationIds.includes(id))) return null;
        journalRef.current = { ...journal, durableImmediate: true };
        timingRef.current = 'now';
        setTiming('now');
        if (!saveRef.current() || foreignLockRef.current) return null;
        ownPostStartedRef.current = true;
        setOwnPostStarted(true);
        return journal.attemptId;
      });
    } catch {
      setMessage('The publishing attempt could not be saved safely. No new request was started.');
      return null;
    }
  };
  const safeSubmissionFailure = () => {
    if (ownPostStartedRef.current) return;
    try {
      if (adoptJournal() || !scope) return;
      const identity = latest.current.user!;
      const raw = localStorage.getItem(scope);
      if (raw) {
        const saved = readComposerDraft(raw, identity.id, identity.orgId);
        localStorage.setItem(
          scope,
          JSON.stringify({ ...saved, journal: null })
        );
      }
      journalRef.current = null;
      saveRef.current();
    } catch {
      setMessage(
        'The publishing attempt remains locked. Check Schedule before trying again.'
      );
    }
  };
  const savedDraftComplete = () => {
    try {
      if (!scope || adoptJournal() || journalRef.current) return;
      localStorage.removeItem(scope);
      completedRef.current = true;
      readyRef.current = false;
    } catch {
      setMessage(
        'Your post draft was saved, but temporary composer recovery could not be cleared.'
      );
    }
  };
  const startBlank = () => {
    if (currentScope.current !== scope) return;
    const discard = () => {
    try { if (scope) adoptJournal(); } catch { return; }
    // Clearing an uncertain receipt must never mint another publishing identity.
    if (journalRef.current?.durableImmediate && (!submissionStatus || checkingSubmission ||
        submissionStatus.submissionId !== journalRef.current.attemptId ||
        !submissionStatus.destinations.every(item => item.recoverability === 'complete'))) {
      setMessage('Resolve the existing publishing attempt before starting a new draft.');
      return;
    }
    if (
      !window.confirm(
        'Discard the saved composer work? Check Schedule and connected accounts for any previous publishing request before starting again.'
      )
    )
      return;
    try {
      if (scope) localStorage.removeItem(scope);
    } catch {
      setMessage('The saved draft could not be discarded.');
      return;
    }
    readyRef.current = false;
    setPhase('loading');
    resetComposerState();
    setAttempt((value) => value + 1);
    };
    try { if (scope) adoptJournal(); } catch { return; }
    if (journalRef.current?.durableImmediate) {
      if (!navigator.locks?.request) return;
      void navigator.locks.request(`publishing:${scope}`, { ifAvailable: true }, lock => {
        if (lock && currentScope.current === scope) discard();
      }).catch(() => setMessage('The saved publishing attempt could not be cleared safely.'));
    } else discard();
  };
  if (phase === 'loading')
    return <div role="status">Restoring your composer…</div>;
  if (phase === 'blocked')
    return (
      <div role="alert">
        {message}
        <p>Your saved text and settings have been retained.</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry recovery
        </button>
        <button type="button" onClick={startBlank}>
          Discard saved draft
        </button>
      </div>
    );
  return (
    <RecoveryContext.Provider
      value={{
        active: !!scope,
        restored: !!restored,
        restoredSourceId: restored?.guided.sourceMediaId || null,
        publishLocked: !!restored?.journal || foreignLock || ownPostStarted,
        timing,
        setTiming: (value) => {
          timingRef.current = value;
          setTiming(value);
          saveRef.current();
        },
        prepareSubmission,
        beginSubmission,
        beginImmediateSubmission,
        checkImmediateSubmission,
        isImmediateSubmissionCurrent: id => currentScope.current === scope && readyScopeRef.current === scope && readyRef.current &&
          journalRef.current?.attemptId === id && ownPostStartedRef.current,
        safeSubmissionFailure,
        savedDraftComplete,
        settingsSaveFailed: () =>
          setMessage(
            'Some platform settings cannot be saved for recovery. Save a draft or keep this page open before leaving.'
          ),
      }}
    >
      {!!message && <div role="alert">{message}</div>}
      {(!!restored?.journal || foreignLock || ownPostStarted) && (
        <section aria-label="Publishing recovery" className="mb-[16px] rounded-[12px] border border-newBorder bg-newBgColorInner p-[16px]">
          {acknowledged ? <p role="status">Publishing remains locked until you start a new draft.</p> : <div role="alert">
            <h2 className="font-[600]">Check your previous publishing request</h2>
            <p>A previous publishing request may already have been accepted. Check Schedule and connected accounts before starting another post.</p>
          </div>}
          <div className="mt-[8px] flex flex-wrap gap-[12px]">
            <a href="/launches" className="inline-flex min-h-[44px] items-center underline">Open Schedule</a>
            <button type="button" className="min-h-[44px] underline" onClick={() => setAcknowledged(value => !value)}>{acknowledged ? 'Show recovery details' : 'Acknowledge notice'}</button>
            <button type="button" className="min-h-[44px] underline" onClick={startBlank}>Start a new draft</button>
          </div>
          {journalRef.current?.durableImmediate && <div aria-label="Submission status">
            {submissionStatus?.destinations.map(item => <div key={item.integrationId}>
              <p>{integrations.find(account => account.id === item.integrationId)?.name || 'Selected account'}: {submissionLabels[item.state]}</p>
              {item.recoverability === 'retry-before-provider' && <button type="button" disabled={checkingSubmission}
                onClick={() => void checkImmediateSubmission(item.integrationId)}>Retry publishing to {integrations.find(account => account.id === item.integrationId)?.name || 'selected account'}</button>}
            </div>)}
            <button type="button" disabled={checkingSubmission} onClick={() => void checkImmediateSubmission()}>Check publishing status</button>
            {submissionStatus?.destinations.some(item => item.recoverability === 'resume-dispatch') && <button type="button"
              disabled={checkingSubmission} onClick={() => void checkImmediateSubmission('resume')}>Resume pending dispatch</button>}
          </div>}
        </section>
      )}
      <React.Fragment key={attempt}>{children}</React.Fragment>
    </RecoveryContext.Provider>
  );
}
