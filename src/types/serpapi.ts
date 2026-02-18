export interface SerpApiGpsCoordinates {
  latitude: number;
  longitude: number;
}

export interface SerpApiLocalResult {
  position: number;
  title: string;
  place_id: string;
  data_cid?: string;
  rating?: number;
  reviews?: number;
  address?: string;
  phone?: string;
  website?: string;
  type?: string;
  types?: string[];
  description?: string;
  operating_hours?: Record<string, string>;
  thumbnail?: string;
  unclaimed_listing?: boolean;
  gps_coordinates: SerpApiGpsCoordinates;
}

export interface SerpApiPagination {
  next?: string;
}

export interface SerpApiMapsResponse {
  local_results?: SerpApiLocalResult[];
  serpapi_pagination?: SerpApiPagination;
  search_metadata: {
    status: string;
    id: string;
  };
}
