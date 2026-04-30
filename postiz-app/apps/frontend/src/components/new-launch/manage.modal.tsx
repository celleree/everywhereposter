'use client';

import React, {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AddEditModalProps } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PicksSocialsComponent } from '@gitroom/frontend/components/new-launch/picks.socials.component';
import { EditorWrapper } from '@gitroom/frontend/components/new-launch/editor';
import { SelectCurrent } from '@gitroom/frontend/components/new-launch/select.current';
import { ShowAllProviders } from '@gitroom/frontend/components/new-launch/providers/show.all.providers';
import { useExistingData } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { DatePicker } from '@gitroom/frontend/components/launches/helpers/date.picker';
import { useShallow } from 'zustand/react/shallow';
import { RepeatComponent } from '@gitroom/frontend/components/launches/repeat.component';
import { TagsComponent } from '@gitroom/frontend/components/launches/tags.component';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { weightedLength } from '@gitroom/helpers/utils/count.length';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { capitalize } from 'lodash';
import { SelectCustomer } from '@gitroom/frontend/components/launches/select.customer';
import { CopilotPopup } from '@copilotkit/react-ui';
import { DummyCodeComponent } from '@gitroom/frontend/components/new-launch/dummy.code.component';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import {
  SettingsIcon,
  ChevronDownIcon,
  CloseIcon,
  TrashIcon,
  DropdownArrowSmallIcon,
} from '@gitroom/frontend/components/ui/icons';
import { useHasScroll } from '@gitroom/frontend/components/ui/is.scroll.hook';
import { useShortlinkPreference } from '@gitroom/frontend/components/settings/shortlink-preference.component';
import dayjs from 'dayjs';
import { Button } from '@gitroom/react/form/button';

function countCharacters(text: string, type: string): number {
  if (type !== 'x') {
    return text.length;
  }
  return weightedLength(text);
}

export const ManageModal: FC<AddEditModalProps> = (props) => {
  const t = useT();
  const fetch = useFetch();
  const ref = useRef(null);
  const existingData = useExistingData();
  const [loading, setLoading] = useState(false);
  const toaster = useToaster();
  const modal = useModals();
  const [showSettings, setShowSettings] = useState(false);
  const { data: shortlinkPreferenceData } = useShortlinkPreference();

  const { addEditSets, mutate, customClose, dummy } = props;

  const {
    selectedIntegrations,
    hide,
    date,
    setDate,
    repeater,
    setRepeater,
    tags,
    setTags,
    integrations,
    setSelectedIntegrations,
    locked,
    current,
    activateExitButton,
    setHide,
  } = useLaunchStore(
    useShallow((state) => ({
      hide: state.hide,
      setHide: state.setHide,
      date: state.date,
      setDate: state.setDate,
      current: state.current,
      repeater: state.repeater,
      setRepeater: state.setRepeater,
      tags: state.tags,
      setTags: state.setTags,
      selectedIntegrations: state.selectedIntegrations,
      integrations: state.integrations,
      setSelectedIntegrations: state.setSelectedIntegrations,
      locked: state.locked,
      activateExitButton: state.activateExitButton,
    }))
  );

  useEffect(() => {
    if (hide) {
      setHide(false);
    }
  }, [hide]);

  const currentIntegrationText = useMemo(() => {
    if (current === 'global') {
      return (
        <div className="flex items-center gap-[10px]">
          <div className="relative">
            <SettingsIcon size={15} className="text-white" />
          </div>
          <div>Settings</div>
        </div>
      );
    }

    const currentIntegration = integrations.find((p) => p.id === current)!;

    return (
      <div className="flex items-center gap-[10px]">
        <div className="relative">
          <img
            src={`/icons/platforms/${currentIntegration.identifier}.png`}
            className="w-[20px] h-[20px] rounded-[4px]"
            alt={currentIntegration.identifier}
          />
          <SettingsIcon
            size={15}
            className="text-white absolute -end-[5px] -bottom-[5px]"
          />
        </div>
        <div>
          {currentIntegration.name} {t('channel_settings', 'Settings')}
        </div>
      </div>
    );
  }, [current]);

  const existingRootPost = existingData?.posts?.[0];
  const existingIntegration = useMemo(
    () => integrations.find((integration) => integration.id === existingData.integration),
    [integrations, existingData.integration]
  );
  const publishedCapabilities = existingIntegration?.publishedCapabilities;
  const isPublishedPost = existingRootPost?.state === 'PUBLISHED';
  const isRemoteDeletedPost = existingRootPost?.state === 'DELETED_REMOTE';
  const showPublishedActions =
    !!existingData?.integration && (isPublishedPost || isRemoteDeletedPost);
  const missingPublishedReleaseId =
    !!existingData?.integration &&
    (!existingRootPost?.releaseId || existingRootPost?.releaseId === 'missing');

  const updatePublishedDisabledReason = useMemo(() => {
    if (!showPublishedActions) {
      return '';
    }

    if (isRemoteDeletedPost) {
      return t(
        'this_post_was_already_deleted_on_the_platform',
        'This post was already deleted on the platform.'
      );
    }

    if (missingPublishedReleaseId) {
      return t(
        'published_post_is_missing_platform_id',
        'This published post is missing its platform ID, so it cannot be updated.'
      );
    }

    if (publishedCapabilities?.requiresReconnect) {
      return (
        publishedCapabilities.reason ||
        t(
          'reconnect_channel_to_manage_published_posts',
          'Reconnect this channel to manage published posts.'
        )
      );
    }

    if (publishedCapabilities?.editMode === 'none') {
      return (
        publishedCapabilities.reason ||
        t(
          'provider_does_not_support_published_edits',
          'This platform does not support editing published posts yet.'
        )
      );
    }

    return '';
  }, [
    showPublishedActions,
    isRemoteDeletedPost,
    missingPublishedReleaseId,
    publishedCapabilities,
    t,
  ]);

  const deleteOnPlatformDisabledReason = useMemo(() => {
    if (!showPublishedActions) {
      return '';
    }

    if (isRemoteDeletedPost) {
      return t(
        'this_post_was_already_deleted_on_the_platform',
        'This post was already deleted on the platform.'
      );
    }

    if (missingPublishedReleaseId) {
      return t(
        'published_post_is_missing_platform_id',
        'This published post is missing its platform ID, so it cannot be deleted on the platform.'
      );
    }

    if (publishedCapabilities?.requiresReconnect) {
      return (
        publishedCapabilities.reason ||
        t(
          'reconnect_channel_to_manage_published_posts',
          'Reconnect this channel to manage published posts.'
        )
      );
    }

    if (!publishedCapabilities?.canDeletePublished) {
      return (
        publishedCapabilities?.reason ||
        t(
          'provider_does_not_support_published_deletes',
          'This platform does not support deleting published posts yet.'
        )
      );
    }

    return '';
  }, [
    showPublishedActions,
    isRemoteDeletedPost,
    missingPublishedReleaseId,
    publishedCapabilities,
    t,
  ]);

  const publishedActionHint = useMemo(() => {
    if (!showPublishedActions) {
      return '';
    }

    if (isRemoteDeletedPost) {
      return t(
        'deleted_on_platform_can_republish',
        'This post was already deleted on the platform. You can republish it or remove it from Publish Everywhere.'
      );
    }

    return (
      updatePublishedDisabledReason ||
      deleteOnPlatformDisabledReason ||
      publishedCapabilities?.constraints?.[0] ||
      ''
    );
  }, [
    showPublishedActions,
    isRemoteDeletedPost,
    updatePublishedDisabledReason,
    deleteOnPlatformDisabledReason,
    publishedCapabilities,
    t,
  ]);

  const changeCustomer = useCallback(
    (customer: string) => {
      const neededIntegrations = integrations.filter(
        (p) => p?.customer?.id === customer
      );
      setSelectedIntegrations(
        neededIntegrations.map((p) => ({
          settings: {},
          selectedIntegrations: p,
        }))
      );
    },
    [integrations]
  );

  const askClose = useCallback(async () => {
    if (!activateExitButton || dummy) {
      return;
    }

    if (
      await deleteDialog(
        t(
          'are_you_sure_you_want_to_close_this_modal_all_data_will_be_lost',
          'Are you sure you want to close this modal? (all data will be lost)'
        ),
        t('yes_close_it', 'Yes, close it!')
      )
    ) {
      if (customClose) {
        customClose();
        return;
      }
      modal.closeAll();
    }
  }, [activateExitButton, dummy]);

  const deletePost = useCallback(async () => {
    setLoading(true);
    const confirmationMessage = showPublishedActions
      ? t(
          'are_you_sure_you_want_to_remove_this_post_from_publish_everywhere',
          'Are you sure you want to remove this post from Publish Everywhere? This does not change the live platform post.'
        )
      : t(
          'are_you_sure_you_want_to_delete_post',
          'Are you sure you want to delete this post?'
        );
    if (
      !(await deleteDialog(
        confirmationMessage,
        showPublishedActions
          ? t('yes_remove_it', 'Yes, remove it!')
          : t('yes_delete_it', 'Yes, delete it!')
      ))
    ) {
      setLoading(false);
      return;
    }
    await fetch(`/posts/${existingData.group}`, {
      method: 'DELETE',
    });
    mutate();
    modal.closeAll();
    return;
  }, [existingData, mutate, modal, showPublishedActions, t]);

  const deletePublishedPost = useCallback(async () => {
    if (!existingData.group || deleteOnPlatformDisabledReason) {
      return;
    }

    setLoading(true);

    if (
      !(await deleteDialog(
        t(
          'are_you_sure_you_want_to_delete_this_post_on_the_platform',
          'Are you sure you want to delete this post on the live platform?'
        ),
        t('yes_delete_on_platform', 'Yes, delete it!')
      ))
    ) {
      setLoading(false);
      return;
    }

    const response = await fetch(`/posts/${existingData.group}/published`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      let message = t(
        'failed_to_delete_the_published_post',
        'Failed to delete the published post.'
      );

      try {
        const raw = await response.text();
        if (raw) {
          const parsed = JSON.parse(raw);
          message = Array.isArray(parsed?.message)
            ? parsed.message.join(', ')
            : parsed?.message || parsed?.error || raw;
        }
      } catch {
        // Keep the fallback message when the response is not JSON.
      }

      toaster.show(message, 'warning');
      setLoading(false);
      return;
    }

    mutate();
    toaster.show(
      t(
        'published_post_deleted_on_platform',
        'Published post deleted on platform'
      )
    );
    modal.closeAll();
  }, [
    existingData.group,
    deleteOnPlatformDisabledReason,
    fetch,
    modal,
    mutate,
    t,
    toaster,
  ]);

  const schedule = useCallback(
    (type: 'draft' | 'now' | 'schedule' | 'update') => async () => {
      if (
        (type === 'now' || type === 'schedule') &&
        (existingData?.posts?.[0]?.state === 'PUBLISHED' ||
          (existingData?.posts?.[0]?.state === 'QUEUE' &&
            dayjs().isAfter(date.utc())))
      ) {
        const whatToDo = await new Promise((resolve) => {
          modal.openModal({
            title: 'What do you want to do?',
            children: (
              <div className="flex flex-col">
                <div className="text-[20px] mb-[20px]">
                  This post was already published, what do you want to do?
                </div>
                <div className="flex w-full gap-[10px]">
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => resolve('update')}
                    >
                      Just update the post details
                    </Button>
                  </div>
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => resolve('republish')}
                    >
                      Republish the post
                    </Button>
                  </div>
                </div>
              </div>
            ),
          });
        });

        if (whatToDo === 'update') {
          type = 'update';
        }
      }

      setLoading(true);
      const checkAllValid = await ref.current.checkAllValid();

      const notEnoughChars = checkAllValid.filter((p: any) => {
        return p.values.some((a: any) => {
          return (
            countCharacters(
              stripHtmlValidation('normal', a.content, true),
              p?.integration?.identifier || ''
            ) === 0 && a.media?.length === 0
          );
        });
      });

      for (const item of notEnoughChars) {
        toaster.show(
          `${capitalize(item.integration.identifier.split('-')[0])} (${
            item.integration.name
          }):` +
            ' ' +
            t(
              'post_needs_content_or_image',
              'Your post should have at least one character or one image.'
            ),
          'warning'
        );
        setLoading(false);
        item.preview();
        return;
      }

      if (type !== 'draft') {
        for (const item of checkAllValid) {
          if (item.valid === false) {
            toaster.show(
              `${capitalize(item.integration.identifier.split('-')[0])} (${
                item.integration.name
              }): ${t('please_fix_your_settings', 'Please fix your settings')}`,
              'warning'
            );
            item.fix();
            setLoading(false);
            setShowSettings(true);
            return;
          }

          if (item.errors !== true) {
            toaster.show(
              `${capitalize(item.integration.identifier.split('-')[0])} (${
                item.integration.name
              }): ${item.errors}`,
              'warning'
            );
            item.preview();
            setLoading(false);
            setShowSettings(false);
            return;
          }
        }

        const sliceNeeded = checkAllValid.filter((p: any) => {
          return p.values.some((a: any) => {
            const strip = stripHtmlValidation('normal', a.content, true);
            const weightedLength = countCharacters(
              strip,
              p?.integration?.identifier || ''
            );
            const totalCharacters =
              weightedLength > strip.length ? weightedLength : strip.length;

            return totalCharacters > (p.maximumCharacters || 1000000);
          });
        });

        for (const item of sliceNeeded) {
          toaster.show(
            `${item?.integration?.name} (${item?.integration?.identifier}) ${t(
              'post_is_too_long',
              'post is too long, please fix it'
            )}`,
            'warning'
          );
          item.preview();
          setLoading(false);
          return;
        }
      }

      const shortlinkPreference = shortlinkPreferenceData?.shortlink || 'ASK';

      let shortLink = false;

      if (!dummy && shortlinkPreference !== 'NO') {
        const shortLinkUrl = await (
          await fetch('/posts/should-shortlink', {
            method: 'POST',
            body: JSON.stringify({
              messages: checkAllValid.flatMap((p: any) =>
                p.values.flatMap((a: any) => a.content)
              ),
            }),
          })
        ).json();

        if (shortLinkUrl.ask) {
          if (shortlinkPreference === 'YES') {
            // Automatically shortlink without asking
            shortLink = true;
          } else {
            // ASK: Show the dialog
            shortLink = await deleteDialog(
              t(
                'shortlink_urls_question',
                'Do you want to shortlink the URLs? it will let you get statistics over clicks'
              ),
              t('yes_shortlink_it', 'Yes, shortlink it!')
            );
          }
        }
      }

      const group = existingData.group || makeId(10);
      const data = {
        type,
        ...(repeater ? { inter: repeater } : {}),
        tags,
        shortLink,
        date: date.utc().format('YYYY-MM-DDTHH:mm:ss'),
        posts: checkAllValid.map((post: any) => ({
          integration: {
            id: post.integration.id,
          },
          group,
          settings: { ...(post.settings || {}) },
          value: post.values.map((value: any) => ({
            ...(value.id ? { id: value.id } : {}),
            content: value.content,
            delay: value.delay || 0,
            image:
              (value?.media || []).map(
                ({ id, path, alt, thumbnail, thumbnailTimestamp }: any) => ({
                  id,
                  path,
                  alt,
                  thumbnail,
                  thumbnailTimestamp,
                })
              ) || [],
          })),
        })),
      };

      if (dummy) {
        modal.openModal({
          title: '',
          children: <DummyCodeComponent code={data} />,
          classNames: {
            modal: 'w-[100%] bg-transparent text-textColor',
          },
          size: '100%',
          withCloseButton: false,
          closeOnEscape: true,
          closeOnClickOutside: true,
        });

        setLoading(false);
      }

      if (!dummy) {
        try {
          if (addEditSets) {
            await addEditSets(data);
          } else {
            const response = await fetch('/posts', {
              method: 'POST',
              body: JSON.stringify(data),
            });

            if (!response.ok) {
              let message = t('failed_to_save_post', 'Failed to save post');

              try {
                const raw = await response.text();
                if (raw) {
                  const parsed = JSON.parse(raw);
                  message = Array.isArray(parsed?.message)
                    ? parsed.message.join(', ')
                    : parsed?.message || parsed?.error || raw;
                }
              } catch {
                // Keep the fallback message if the response is not JSON.
              }

              toaster.show(message, 'warning');
              setLoading(false);
              return;
            }
          }
        } catch (error) {
          toaster.show(
            error instanceof Error
              ? error.message
              : t('failed_to_save_post', 'Failed to save post'),
            'warning'
          );
          setLoading(false);
          return;
        }

        if (!addEditSets) {
          mutate();
          toaster.show(
            !existingData.integration
              ? t('added_successfully', 'Added successfully')
              : t('updated_successfully', 'Updated successfully')
          );
        }
        if (customClose) {
          setTimeout(() => {
            customClose();
          }, 2000);
        }

        if (!addEditSets) {
          modal.closeAll();
        }
      }
    },
    [ref, repeater, tags, date, addEditSets, dummy, shortlinkPreferenceData]
  );

  return (
    <div className="relative flex h-full w-full flex-1 p-[40px] mobile:p-[12px]">
      <div className="flex flex-1 flex-col rounded-[20px] bg-newBgColorInner">
        <div className="flex flex-1 mobile:min-h-0 mobile:flex-col">
          <div className="flex flex-1 flex-col border-e border-newBorder mobile:border-e-0 mobile:border-b">
            <div className="flex h-[65px] items-center bg-newBgColor px-[20px] text-[20px] font-[600] rounded-s-[20px] !rounded-b-[0] mobile:h-auto mobile:min-h-[65px] mobile:rounded-e-[20px] mobile:px-[16px]">
              {t('create_post_title', 'Create Post')}
            </div>
            <div className="flex-1 flex flex-col gap-[16px]">
              <div
                className={clsx(
                  'relative flex-1 mobile:min-h-[460px]',
                  showSettings && 'hidden'
                )}
              >
                <div
                  id="social-content"
                  className="absolute top-0 left-0 flex h-full w-full flex-col gap-[32px] overflow-x-hidden overflow-y-scroll pe-[8px] pt-[20px] ps-[20px] scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner mobile:gap-[20px] mobile:px-[16px]"
                >
                  <div className="flex w-full mobile:flex-col mobile:gap-[12px]">
                    <div className="flex flex-1">
                      <PicksSocialsComponent toolTip={true} />
                    </div>
                    <div>
                      {!dummy && (
                        <SelectCustomer
                          onChange={changeCustomer}
                          integrations={integrations}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col gap-[6px]">
                    <div>{!existingData.integration && <SelectCurrent />}</div>
                    <div className="flex-1 flex">
                      {!hide && <EditorWrapper totalPosts={1} value="" />}
                    </div>
                    <div
                      id="social-empty"
                      className={clsx(
                        'pb-[16px]'
                        // current !== 'global' && 'hidden'
                      )}
                    />
                  </div>
                </div>
              </div>
              <div
                id="wrapper-settings"
                className={clsx(
                  'select-none px-[20px] pb-[20px] mobile:px-[16px]',
                  showSettings && 'flex-1 flex pt-[20px]',
                  current === 'global' && 'hidden'
                )}
              >
                <div className="flex-1 flex flex-col rounded-[12px] gap-[12px] overflow-hidden bg-newSettings">
                  <div
                    onClick={() => setShowSettings(!showSettings)}
                    className={clsx(
                      'bg-[#612BD3] rounded-[12px] flex items-center gap-[8px] cursor-pointer p-[12px]',
                      showSettings ? '!rounded-b-none' : ''
                    )}
                  >
                    <div className="flex-1 text-[14px] font-[600] text-white">
                      {currentIntegrationText}
                    </div>
                    <div>
                      <ChevronDownIcon
                        rotated={showSettings}
                        className="text-white"
                      />
                    </div>
                  </div>
                  <div
                    className={clsx(
                      !showSettings ? 'hidden' : 'flex-1',
                      'text-[14px] text-textColor font-[500] relative'
                    )}
                  >
                    <div className="absolute left-0 top-0 w-full h-full flex flex-col overflow-x-hidden overflow-y-auto scrollbar scrollbar-thumb-newBgColorInner scrollbar-track-newColColor">
                      <div
                        id="social-settings"
                        className="flex flex-col gap-[20px] bg-newBgColor mobile:px-[2px]"
                      />
                    </div>
                  </div>
                  <style>
                    {`#social-settings [data-id="${current}"] {display: block !important;}`}
                  </style>
                </div>
              </div>
            </div>
          </div>
          <div className="flex w-[580px] flex-col mobile:w-full mobile:min-h-[360px]">
            <div className="flex h-[65px] items-center bg-newBgColor px-[20px] text-[20px] font-[600] rounded-e-[20px] !rounded-b-[0] mobile:h-auto mobile:min-h-[65px] mobile:rounded-s-none mobile:px-[16px]">
              <div className="flex-1">{t('post_preview', 'Post Preview')}</div>
              <div className="cursor-pointer">
                <CloseIcon onClick={askClose} className="text-[#A3A3A3]" />
              </div>
            </div>
            <div className="relative flex-1 mobile:min-h-[320px]">
              <Scrollable
                scrollClasses="!pe-[20px]"
                className="absolute top-0 left-0 h-full w-full overflow-x-hidden overflow-y-scroll p-[20px] pe-[8px] scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner mobile:px-[16px]"
              >
                <ShowAllProviders ref={ref} />
              </Scrollable>
            </div>
          </div>
        </div>
        <div className="flex min-h-[84px] items-center border-t border-newBorder py-[16px] select-none mobile:flex-col mobile:items-stretch mobile:gap-[12px]">
          <div className="flex flex-1 gap-[8px] ps-[20px] mobile:flex-wrap mobile:px-[16px]">
            {!dummy && (
              <TagsComponent
                name="tags"
                label={t('tags', 'Tags')}
                initial={tags}
                onChange={(e) => {
                  setTags(e.target.value);
                }}
              />
            )}

            {!dummy && (
              <RepeatComponent repeat={repeater} onChange={setRepeater} />
            )}
          </div>
          <div className="flex flex-col items-end gap-[8px] pe-[20px] mobile:px-[16px] mobile:items-stretch">
            <div className="flex items-center justify-end gap-[8px] mobile:flex-col mobile:items-stretch">
              {showPublishedActions && (
                <span title={deleteOnPlatformDisabledReason || undefined}>
                  <button
                    disabled={
                      !!deleteOnPlatformDisabledReason || loading || locked
                    }
                    onClick={deletePublishedPost}
                    className="flex cursor-pointer items-center gap-[8px] text-[15px] font-[600] text-[#FF8A5C] disabled:cursor-not-allowed disabled:opacity-50 mobile:w-full mobile:justify-center"
                  >
                    <div>
                      <TrashIcon />
                    </div>
                    <div>
                      {isRemoteDeletedPost
                        ? t('deleted_on_platform', 'Deleted on platform')
                        : t('delete_on_platform', 'Delete on platform')}
                    </div>
                  </button>
                </span>
              )}
              {existingData?.integration && (
                <button
                  onClick={deletePost}
                  className="flex cursor-pointer items-center gap-[8px] text-[15px] font-[600] text-[#FF3F3F] mobile:w-full mobile:justify-center"
                >
                  <div>
                    <TrashIcon />
                  </div>
                  <div>
                    {showPublishedActions
                      ? t('remove_from_app', 'Remove from app')
                      : t('delete_post', 'Delete Post')}
                  </div>
                </button>
              )}
              {(!showPublishedActions || isRemoteDeletedPost) && (
                <DatePicker onChange={setDate} date={date} />
              )}
            {!addEditSets && (
              <button
                disabled={
                  selectedIntegrations.length === 0 || loading || locked
                }
                onClick={schedule('draft')}
                className="relative flex h-[44px] cursor-pointer items-center justify-center rounded-[8px] bg-btnSimple px-[20px] text-[15px] font-[600] disabled:cursor-not-allowed mobile:w-full"
              >
                {loading && (
                  <div className="absolute left-[50%] top-[50%] -translate-y-[50%] -translate-x-[50%]">
                    <div className="animate-spin h-[20px] w-[20px] border-4 border-textColor border-t-transparent rounded-full" />
                  </div>
                )}
                <div className={clsx(loading && 'invisible')}>
                  {t('save_as_draft', 'Save as Draft')}
                </div>
              </button>
            )}
            {addEditSets && (
              <button
                className="btnSub flex h-[44px] min-w-[180px] items-center justify-center gap-[8px] rounded-[8px] bg-[#612BD3] ps-[20px] pe-[16px] text-[15px] font-[600] text-white outline-none disabled:cursor-not-allowed disabled:opacity-80 mobile:w-full mobile:min-w-0"
                disabled={
                  selectedIntegrations.length === 0 || loading || locked
                }
                onClick={schedule('draft')}
              >
                Save Set
              </button>
            )}
            {!addEditSets && (
              <div className="group relative cursor-pointer mobile:w-full">
                <button
                  disabled={
                    selectedIntegrations.length === 0 ||
                    loading ||
                    locked ||
                    (isPublishedPost && !!updatePublishedDisabledReason)
                  }
                  onClick={schedule(
                    isPublishedPost ? 'update' : 'schedule'
                  )}
                  className="btnSub relative flex h-[44px] min-w-[180px] items-center justify-center gap-[8px] rounded-[8px] bg-[#612BD3] ps-[20px] pe-[16px] text-white outline-none disabled:cursor-not-allowed disabled:opacity-80 mobile:w-full mobile:min-w-0"
                >
                  {loading && (
                    <div className="absolute left-[50%] top-[50%] -translate-y-[50%] -translate-x-[50%]">
                      <div className="animate-spin h-[20px] w-[20px] border-4 border-white border-t-transparent rounded-full" />
                    </div>
                  )}
                  <div
                    className={clsx(
                      'text-[15px] font-[600]',
                      loading && 'invisible'
                    )}
                  >
                    {selectedIntegrations.length === 0
                      ? t('check_circles_above', 'Check the circles above')
                      : dummy
                      ? t('create_output', 'Create output')
                      : isRemoteDeletedPost
                      ? t('republish_post', 'Republish post')
                      : isPublishedPost
                      ? t('update_published_post', 'Update published post')
                      : !existingData?.integration
                      ? t('add_to_calendar', 'Add to calendar')
                      : existingData?.posts?.[0]?.state === 'DRAFT'
                      ? t('schedule', 'Schedule')
                      : t('update', 'Update')}
                  </div>
                  {!dummy && !isPublishedPost && (
                    <div className="flex justify-center items-center h-[20px] w-[20px] pt-[4px] arrow-change">
                      <DropdownArrowSmallIcon className="group-hover:rotate-180 text-white" />
                    </div>
                  )}
                </button>

                {!dummy && !isPublishedPost && (
                  <button
                    onClick={schedule('now')}
                    disabled={
                      selectedIntegrations.length === 0 || loading || locked
                    }
                    className="absolute bottom-[100%] -left-[12px] z-[300] hidden w-[206px] rounded-[8px] bg-newBgColorInner p-[12px] disabled:cursor-not-allowed disabled:opacity-80 group-hover:flex mobile:hidden"
                  >
                    <div className="text-white rounded-[8px] bg-[#D82D7E] h-[44px] w-full flex justify-center items-center post-now">
                      {t('post_now', 'Post Now')}
                    </div>
                  </button>
                )}
              </div>
            )}
            </div>
            {!!publishedActionHint && (
              <div className="max-w-[420px] text-end text-[12px] text-[#A3A3A3] mobile:max-w-none mobile:text-start">
                {publishedActionHint}
              </div>
            )}
          </div>
        </div>
      </div>
      <CopilotPopup
        hitEscapeToClose={false}
        clickOutsideToClose={true}
        instructions={`
You are an assistant that help the user to schedule their social media posts,
Here are the things you can do:
- Add a new comment / post to the list of posts
- Delete a comment / post from the list of posts
- Add content to the comment / post
- Activate or deactivate the comment / post

Post content can be added using the addPostContentFor{num} function.
After using the addPostFor{num} it will create a new addPostContentFor{num+ 1} function.
`}
        labels={{
          title: t('your_assistant', 'Your Assistant'),
          initial: t(
            'assistant_initial_message',
            'Hi! I can help you to refine your social media posts.'
          ),
        }}
      />
    </div>
  );
};

const Scrollable: FC<{
  className: string;
  scrollClasses: string;
  children: ReactNode;
}> = ({ className, scrollClasses, children }) => {
  const ref = useRef(undefined);
  const hasScroll = useHasScroll(ref);
  return (
    <div className={clsx(className, hasScroll && scrollClasses)} ref={ref}>
      {children}
    </div>
  );
};
