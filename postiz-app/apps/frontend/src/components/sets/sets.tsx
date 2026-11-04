'use client';
import 'reflect-metadata';

import React, {
  FC,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { usePathname } from 'next/navigation';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';

const SaveSetModal: FC<{
  initialValue?: string;
  onSave: (name: string, isActive: () => boolean) => Promise<void>;
  onCancel: () => void;
}> = ({ onSave, onCancel, initialValue = '' }) => {
  const [name, setName] = useState(initialValue);
  const t = useT();
  const pending = useRef(false);
  const mounted = useRef(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      await onSave(name.trim(), () => mounted.current);
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <form
      aria-busy={saving}
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
    >
      <div>
        <Input
          label="Set Name"
          translationKey="label_set_name"
          name="setName"
          value={name}
          disableForm={true}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter a name for this set"
          disabled={saving}
          autoFocus
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" secondary disabled={saving} onClick={onCancel}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving ? t('saving', 'Saving…') : t('save', 'Save')}
        </Button>
      </div>
    </form>
  );
};

export const Sets: FC = () => {
  const fetch = useFetch();
  const user = useUser();
  const modal = useModals();
  const toaster = useToaster();

  const pathname = usePathname();
  const scope = useMemo(
    () => ({ active: true }),
    [user?.id, user?.orgId, pathname]
  );
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const current = useCallback(
    () => scope.active && currentScope.current === scope,
    [scope]
  );
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const refreshSequence = useRef(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  useEffect(() => {
    scope.active = true;
    pending.current = false;
    setDeleting(null);
    setSaving(false);
    setRefreshFailed(false);
    return () => {
      scope.active = false;
    };
  }, [scope]);

  const load = useCallback(async () => {
    const response = await fetch('/integrations/list');
    if (!response.ok) throw new Error('Unable to load integrations');
    const result = await response.json();
    if (!current() || !Array.isArray(result.integrations))
      throw new Error('Invalid integrations');
    return result.integrations;
  }, [fetch, current]);
  const identityReady = !!user?.id && !!user?.orgId;
  const { data: integrations = [] } = useSWR(
    identityReady ? ['sets-integrations', user.id, user.orgId] : null,
    load,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  const validRow = useCallback(
    (row: any) =>
      row &&
      typeof row.id === 'string' &&
      row.organizationId === user?.orgId &&
      typeof row.name === 'string' &&
      typeof row.content === 'string',
    [user?.orgId]
  );
  const list = useCallback(async () => {
    const response = await fetch('/sets');
    if (!response.ok) throw new Error('Unable to load sets');
    const rows = await response.json();
    if (!current() || !Array.isArray(rows) || !rows.every(validRow))
      throw new Error('Invalid sets response');
    return rows;
  }, [fetch, current, validRow]);
  const { data, error, mutate } = useSWR(
    identityReady ? ['sets', user.id, user.orgId] : null,
    list,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
      revalidateOnMount: true,
      keepPreviousData: false,
    }
  );
  const refresh = useCallback(async () => {
    if (!current()) return;
    const sequence = ++refreshSequence.current;
    try {
      // A mutation invalidates older list requests; publish only the authoritative GET.
      await mutate(list(), { revalidate: false });
      if (current() && sequence === refreshSequence.current)
        setRefreshFailed(false);
    } catch {
      if (current() && sequence === refreshSequence.current)
        setRefreshFailed(true);
    }
  }, [current, mutate, list]);

  const addSet = useCallback(
    (params?: { id?: string; name?: string; content?: string }) => () => {
      if (!identityReady || !current() || pending.current) return;
      modal.openModal({
        id: 'add-edit-modal',
        closeOnClickOutside: false,
        removeLayout: true,
        closeOnEscape: false,
        withCloseButton: false,
        askClose: true,
        fullScreen: true,
        classNames: {
          modal: 'w-[100%] max-w-[1400px] text-textColor',
        },
        children: (
          <AddEditModal
            allIntegrations={integrations.map((p: any) => ({
              ...p,
            }))}
            {...(params?.id ? { set: JSON.parse(params.content) } : {})}
            addEditSets={(data) => {
              if (!current() || pending.current) return;
              modal.openModal({
                title: 'Save as Set',
                size: 'min(600px, calc(100vw - 32px))',
                children: (
                  <SaveSetModal
                    initialValue={params?.name || ''}
                    onSave={async (name, isActive) => {
                      const active = () => current() && isActive();
                      if (!active() || pending.current) return;
                      pending.current = true;
                      setSaving(true);
                      let rejected = false;
                      try {
                        const response = await fetch('/sets', {
                          method: 'POST',
                          body: JSON.stringify({
                            ...(params?.id ? { id: params.id } : {}),
                            name,
                            content: JSON.stringify(data),
                          }),
                        });
                        if (!active()) return;
                        rejected = !response.ok;
                        if (rejected) throw new Error('Save rejected');
                        const saved = await response.json();
                        if (!active()) return;
                        if (
                          !saved ||
                          typeof saved.id !== 'string' ||
                          !saved.id ||
                          (params?.id && saved.id !== params.id)
                        )
                          throw new Error('Invalid save response');
                        modal.closeAll();
                        toaster.show('Set saved successfully', 'success');
                        void refresh();
                      } catch {
                        if (active())
                          toaster.show(
                            rejected
                              ? 'Failed to save set'
                              : 'Could not confirm the save. Refresh the list before retrying.',
                            'warning'
                          );
                      } finally {
                        if (current()) {
                          pending.current = false;
                          setSaving(false);
                        }
                      }
                    }}
                    onCancel={() => {
                      if (current()) modal.closeAll();
                    }}
                  />
                ),
              });
            }}
            reopenModal={() => {}}
            mutate={() => {}}
            integrations={integrations}
            date={newDayjs()}
          />
        ),
        title: ``,
      });
    },
    [integrations, modal, fetch, toaster, current, identityReady, refresh]
  );

  const deleteSet = useCallback(
    (row: any) => async () => {
      if (!identityReady || !current() || pending.current || !validRow(row))
        return;
      pending.current = true;
      setDeleting(row.id);
      let rejected = false;
      try {
        if (
          !(await deleteDialog(
            `Are you sure you want to delete ${row.name}?`
          )) ||
          !current()
        )
          return;
        const response = await fetch(`/sets/${row.id}`, { method: 'DELETE' });
        if (!current()) return;
        rejected = !response.ok;
        if (rejected) throw new Error('Delete rejected');
        const deleted = await response.json();
        if (!current()) return;
        if (!validRow(deleted) || deleted.id !== row.id)
          throw new Error('Invalid delete response');
        await mutate(
          (rows: any[] | undefined) =>
            current() ? rows?.filter((item) => item.id !== deleted.id) : rows,
          { revalidate: false }
        );
        if (!current()) return;
        toaster.show('Set deleted successfully', 'success');
        void refresh();
      } catch {
        if (current())
          toaster.show(
            rejected
              ? 'Failed to delete set'
              : 'Could not confirm the deletion. Refresh the list before retrying.',
            'warning'
          );
      } finally {
        if (current()) {
          pending.current = false;
          setDeleting(null);
        }
      }
    },
    [identityReady, current, validRow, fetch, mutate, toaster, refresh]
  );

  const t = useT();

  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">Sets ({data?.length || 0})</h3>
      <div className="text-customColor18 mt-[4px]">
        Manage your content sets for easy reuse across posts.
      </div>
      {(error || refreshFailed) && (
        <div role="alert" className="my-4 flex flex-wrap items-center gap-2">
          Unable to refresh sets. Refresh the list to see the latest changes.
          <Button onClick={() => void refresh()}>Refresh sets</Button>
        </div>
      )}
      <div className="my-[16px] mt-[16px] bg-sixth border-fifth items-center border rounded-[4px] p-[24px] flex gap-[24px]">
        <div className="flex flex-col w-full">
          {!!data?.length && (
            <div className="grid grid-cols-[minmax(0,2fr),auto,auto] gap-x-2 sm:gap-x-4 w-full gap-y-[10px]">
              <div>{t('name', 'Name')}</div>
              <div>{t('edit', 'Edit')}</div>
              <div>{t('delete', 'Delete')}</div>
              {data?.map((p: any) => (
                <Fragment key={p.id}>
                  <div className="flex flex-col justify-center break-words min-w-0">
                    {p.name}
                  </div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button
                        disabled={saving || !!deleting}
                        onClick={addSet(p)}
                        className="!px-3 sm:!px-6"
                      >
                        {t('edit', 'Edit')}
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button
                        disabled={saving || !!deleting}
                        aria-busy={deleting === p.id}
                        onClick={deleteSet(p)}
                        className="!px-3 sm:!px-6"
                      >
                        {deleting === p.id
                          ? t('deleting', 'Deleting…')
                          : t('delete', 'Delete')}
                      </Button>
                    </div>
                  </div>
                </Fragment>
              ))}
            </div>
          )}
          <div>
            <Button
              disabled={!identityReady || saving || !!deleting}
              onClick={addSet()}
              className={clsx((data?.length || 0) > 0 && 'my-[16px]')}
            >
              Add a set
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
