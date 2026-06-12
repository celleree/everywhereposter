'use client';

import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { ReactTags } from 'react-tag-autocomplete';
import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const maxCollaborators = 3;

const normalizeCollaboratorHandle = (value: unknown) =>
  String(value || '')
    .trim()
    .replace(/^@+/, '')
    .trim();

const getCollaboratorKey = (value: unknown) =>
  normalizeCollaboratorHandle(value).toLowerCase();

const normalizeCollaboratorTag = (tag: any) => {
  const label = normalizeCollaboratorHandle(tag?.label ?? tag?.value ?? tag);

  if (!label) {
    return;
  }

  return {
    ...tag,
    label,
    value: label,
  };
};

const normalizeCollaboratorTags = (tags: any[]) =>
  tags
    .map(normalizeCollaboratorTag)
    .filter(Boolean)
    .filter((tag, index, list) => {
      return (
        list.findIndex(
          (item) => getCollaboratorKey(item.label) === getCollaboratorKey(tag.label)
        ) === index
      );
    })
    .slice(0, maxCollaborators);

export const InstagramCollaboratorsTags: FC<{
  name: string;
  label: string;
  onChange: (event: {
    target: {
      value: any[];
      name: string;
    };
  }) => void;
}> = (props) => {
  const { onChange, name, label } = props;
  const { getValues } = useSettings();
  const { integration } = useIntegration();
  const [tagValue, setTagValue] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<string>('');
  const [error, setError] = useState('');
  const t = useT();

  const updateTags = useCallback(
    (tags: any[]) => {
      setTagValue(tags);
      onChange({
        target: {
          value: tags,
          name,
        },
      });
    },
    [name, onChange]
  );

  const onDelete = useCallback(
    (tagIndex: number) => {
      const modify = tagValue.filter((_, i) => i !== tagIndex);
      setError('');
      updateTags(modify);
    },
    [tagValue, updateTags]
  );
  const onAddition = useCallback(
    (newTag: any) => {
      const tag = normalizeCollaboratorTag(newTag);

      if (!tag) {
        setError(t('instagram_collaborator_empty', 'Enter an Instagram handle.'));
        return;
      }

      if (
        tagValue.some(
          (item) => getCollaboratorKey(item.label) === getCollaboratorKey(tag.label)
        )
      ) {
        setError(
          t(
            'instagram_collaborator_duplicate',
            'This collaborator is already added.'
          )
        );
        return;
      }

      if (tagValue.length >= maxCollaborators) {
        setError(
          t(
            'instagram_collaborators_max',
            'Instagram API publishing supports up to 3 collaborators.'
          )
        );
        return;
      }

      setError('');
      setSuggestions('');
      updateTags([...tagValue, tag]);
    },
    [tagValue, t, updateTags]
  );
  useEffect(() => {
    const settings = getValues()[props.name];
    if (settings) {
      setTagValue(normalizeCollaboratorTags(settings));
    }
  }, []);
  const suggestionsArray = useMemo(() => tagValue.filter((f) => f.label), [tagValue]);
  const suggestionsTransform = useCallback((value: string, options: any[]) => {
    const normalizedValue = getCollaboratorKey(value);

    if (!normalizedValue) {
      return options;
    }

    return options.filter((option) =>
      getCollaboratorKey(option?.label ?? option?.value).includes(normalizedValue)
    );
  }, []);
  const reserveDropdownSpace = !!normalizeCollaboratorHandle(suggestions);
  return (
    <div
      className={clsx(
        'instagram-collaborators-tags',
        reserveDropdownSpace && 'pb-[220px]'
      )}
    >
      <div>
        <div className={clsx(`text-[14px] mb-[6px]`)}>{label}</div>
        <ReactTags
          allowNew
          allowResize={false}
          newOptionText={t(
            'add_instagram_collaborator',
            'Add %value%'
          )}
          onValidate={(value) => !!normalizeCollaboratorHandle(value)}
          placeholderText={t('add_a_tag', 'Add a tag')}
          suggestions={suggestionsArray}
          suggestionsTransform={suggestionsTransform}
          selected={tagValue}
          onAdd={onAddition}
          onInput={(value) => {
            setSuggestions(value);
            setError('');
          }}
          onCollapse={() => setSuggestions('')}
          onDelete={onDelete}
        />
        {!!error && (
          <div className="mt-[6px] text-[12px] text-red-500">{error}</div>
        )}
      </div>
    </div>
  );
};
