export interface LocalityRow {
  id: number;
  name: string;
  slug: string;
  sym: string;
  sym_pod: string | null;
  woj: string | null;
  woj_name: string | null;
  pow: string | null;
  pow_name: string | null;
  gmi: string | null;
  gmi_name: string | null;
  lat: number | null;
  lng: number | null;
  distance_km: number | null;
  geocode_failed: number;
  searched_at: string | null;
  created_at: string;
}

export interface BusinessRow {
  id: number;
  locality_id: number;
  place_id: string;
  title: string;
  slug: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  category: string;
  rating: number | null;
  gps_lat: number;
  gps_lng: number;
  data_cid: string | null;
  reviews_count: number | null;
  google_type: string | null;
  google_types: string | null;
  description: string | null;
  operating_hours: string | null;
  thumbnail_url: string | null;
  unclaimed: number;
  site_generated: number;
  created_at: string;
}

export interface BusinessInsert {
  locality_id: number;
  place_id: string;
  title: string;
  slug: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  category: string;
  rating: number | null;
  gps_lat: number;
  gps_lng: number;
  data_cid: string | null;
  reviews_count: number | null;
  google_type: string | null;
  google_types: string | null;
  description: string | null;
  operating_hours: string | null;
  thumbnail_url: string | null;
  unclaimed: number;
}

export interface SellerRow {
  id: number;
  name: string;
  telegram_chat_id: string | null;
  token: string;
  created_at: string;
}

export interface CallLogRow {
  id: number;
  business_id: number;
  seller_id: number;
  status: 'pending' | 'called' | 'interested' | 'rejected';
  comment: string | null;
  created_at: string;
}

export interface Locality {
  id: number;
  name: string;
  slug: string;
  lat: number;
  lng: number;
  distance_km: number;
  searched_at: string | null;
}
