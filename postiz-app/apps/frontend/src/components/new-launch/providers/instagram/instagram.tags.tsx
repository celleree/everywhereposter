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
          (item) => item.label.toLowerCase() === tag.label.toLowerCase()
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
          (item) => item.label.toLowerCase() === tag.label.toLowerCase()
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
            'Instagram supports up to 3 collaborators.'
          )
        );
        return;
      }

      setError('');
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
  const currentSuggestion = normalizeCollaboratorHandle(suggestions);
  const suggestionsArray = useMemo(() => {
    return [
      ...tagValue,
      {
        label: currentSuggestion,
        value: currentSuggestion,
      },
    ].filter((f) => f.label);
  }, [currentSuggestion, tagValue]);
  return (
    <div>
      <div>
        <div className={clsx(`text-[14px] mb-[6px]`)}>{label}</div>
        <ReactTags
          allowResize={false}
          placeholderText={t('add_a_tag', 'Add a tag')}
          suggestions={suggestionsArray}
          selected={tagValue}
          onAdd={onAddition}
          onInput={(value) => {
            setSuggestions(value);
            setError('');
          }}
          onDelete={onDelete}
        />
        {!!error && (
          <div className="mt-[6px] text-[12px] text-red-500">{error}</div>
        )}
      </div>
    </div>
  );
};
