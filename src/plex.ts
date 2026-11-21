/** Plex custom metadata provider response shapes (subset used by this provider). */

export interface PlexImage {
  type: 'background' | 'backgroundSquare' | 'clearLogo' | 'coverPoster' | 'snapshot';
  url: string;
  alt?: string;
}

export interface PlexTag {
  tag: string;
}

export interface PlexPerson {
  tag: string;
  role?: string;
  thumb?: string;
  order?: number;
}

export interface PlexSeasonType {
  id: string;
  source: string;
  tag: string;
  title: string;
}

interface BaseMetadata {
  ratingKey: string;
  key: string;
  guid: string;
  title: string;
  originallyAvailableAt: string;
  year?: number;
  summary?: string;
  thumb?: string;
  art?: string;
  Image?: PlexImage[];
  Guid?: { id: string }[];
}

export interface ShowMetadata extends BaseMetadata {
  type: 'show';
  originalTitle?: string;
  contentRating?: string;
  duration?: number;
  studio?: string;
  Genre?: PlexTag[];
  Network?: PlexTag[];
  Studio?: PlexTag[];
  Role?: PlexPerson[];
  Director?: PlexPerson[];
  Writer?: PlexPerson[];
  Producer?: PlexPerson[];
  SeasonType?: PlexSeasonType[];
  Children?: Children;
}

interface ParentFields {
  index: number;
  parentRatingKey: string;
  parentKey: string;
  parentGuid: string;
  parentType: string;
  parentTitle: string;
  parentThumb?: string;
}

export interface SeasonMetadata extends BaseMetadata, ParentFields {
  type: 'season';
  Children?: Children;
}

export interface EpisodeMetadata extends BaseMetadata, ParentFields {
  type: 'episode';
  duration?: number;
  parentIndex: number;
  grandparentRatingKey: string;
  grandparentKey: string;
  grandparentGuid: string;
  grandparentType: string;
  grandparentTitle: string;
  grandparentThumb?: string;
  Role?: PlexPerson[];
  Director?: PlexPerson[];
  Writer?: PlexPerson[];
}

export type Metadata = ShowMetadata | SeasonMetadata | EpisodeMetadata;

export interface Children {
  size: number;
  Metadata: Metadata[];
}

export interface MediaContainer<K extends string = 'Metadata', T = Metadata> {
  MediaContainer: {
    offset: number;
    totalSize: number;
    identifier: string;
    size: number;
  } & Record<K, T[]>;
}
