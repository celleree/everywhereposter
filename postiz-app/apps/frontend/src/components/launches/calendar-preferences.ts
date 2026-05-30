export const CALENDAR_SHOW_IMPORTED_POSTS_KEY = 'calendar-show-imported-posts';
export const CALENDAR_SHOW_IMPORTED_POSTS_EVENT =
  'calendar-show-imported-posts-changed';

export const getShowImportedPostsInCalendar = () => {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    return window.localStorage.getItem(CALENDAR_SHOW_IMPORTED_POSTS_KEY) !== 'false';
  } catch {
    return true;
  }
};

export const setShowImportedPostsInCalendar = (showImportedPosts: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      CALENDAR_SHOW_IMPORTED_POSTS_KEY,
      showImportedPosts ? 'true' : 'false'
    );
  } catch {}

  window.dispatchEvent(
    new CustomEvent(CALENDAR_SHOW_IMPORTED_POSTS_EVENT, {
      detail: { showImportedPosts },
    })
  );
};
