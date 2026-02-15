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
  address?: string;
  phone?: string;
  website?: string;
  type?: string;
  gps_coordinates: SerpApiGpsCoordinates;
}

export interface SerpApiMapsResponse {
  local_results?: SerpApiLocalResult[];
  search_metadata: {
    status: string;
    id: string;
  };
}
