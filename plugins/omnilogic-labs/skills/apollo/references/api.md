# Apollo.io REST API reference

Base URL `https://api.apollo.io/api/v1`. Auth header `x-api-key: <key>`. JSON bodies. Full docs: https://docs.apollo.io/reference

## Credit cost by endpoint

| Endpoint                                           | Credits     | Notes                                                                                                                                                                             |
| -------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /mixed_people/api_search`                    | 0           | No emails or phones; last names masked. Up to 100 per page.                                                                                                                       |
| `POST /usage_stats/credit_usage_stats`             | 0           | Limits, used, and left per credit type for the cycle.                                                                                                                             |
| `GET /users/api_profile?include_credit_usage=true` | 0           | Key owner plus balances.                                                                                                                                                          |
| `POST /people/match`                               | 1 to 9      | One person. 1 if profile data or email is found, +8 if a mobile phone is returned, 0 if no match. With `match_confidence: low`, charged only if it returns data you did not send. |
| `POST /people/bulk_match`                          | 1 to 9 each | Up to 10 people in `details[]`. Same rules. Response `matches[]`, `null` for no match.                                                                                            |
| `GET /organizations/enrich?domain=`                | 1           | One company.                                                                                                                                                                      |
| `POST /organizations/bulk_enrich`                  | 1 each      | Up to 10 companies.                                                                                                                                                               |
| `POST /mixed_companies/search`                     | 1 per page  | Up to 100 companies per page.                                                                                                                                                     |
| `POST /mixed_people/search`                        | paid        | Older people search; use `api_search` instead.                                                                                                                                    |

Waterfall enrichment (`run_waterfall_email`, `run_waterfall_phone`) asks extra vendors. Some charge per lookup even with no result. Results arrive at `webhook_url`. Do not use it unless the owner asks.

Phone reveal (`reveal_phone_number: true`) needs `webhook_url`; phones arrive asynchronously at that URL, not in the response.

## People search filters (`/mixed_people/api_search`)

- `person_titles[]`: match any; loose unless `include_similar_titles: false`.
- `person_not_titles[]`, `person_not_past_titles[]`: exclusions. Titles in and not-in together must be under 100.
- `person_seniorities[]`: `owner founder c_suite partner vp head director manager senior entry intern`.
- `person_locations[]`: where the person lives (city, US state, country).
- `organization_locations[]`: company HQ.
- `q_organization_domains_list[]`: employer domains, up to 1,000.
- `organization_ids[]`: Apollo company ids.
- `organization_num_employees_ranges[]`: `"lo,hi"` strings such as `"11,50"`.
- `q_keywords`, `q_person_name`.
- `contact_email_status[]`: `verified unverified likely to engage unavailable`.
- `page`, `per_page` (max 100).

Each result: `id`, `first_name`, `last_name_obfuscated`, `title`, `has_email`, `has_direct_phone` (`Yes` or `Maybe: ...`), `organization.name`.

## Enrichment identifiers

`people/match` and each `bulk_match` detail accept any of: `id` (from search), `email`, `linkedin_url`, `first_name` + `last_name` or `name`, with `domain` or `organization_name`. More identifiers raise match confidence. Options: `reveal_personal_emails`, `reveal_phone_number`, `webhook_url`.

Useful fields in the returned person: `email`, `email_status`, `linkedin_url`, `title`, `headline`, `city`, `state`, `country`, `employment_history[]`, `organization{}`.

## Your own CRM data (no credits)

Records already saved in the Apollo account:

- `POST /contacts/search` (`q_keywords`, `contact_stage_ids[]`, `sort_by_field`), `POST /contacts`, `PATCH /contacts/{id}`
- `POST /accounts/search`, `POST /accounts`
- `POST /emailer_campaigns/search` (sequences), `POST /emailer_campaigns/{id}/add_contact_ids`
- `POST /tasks/search`, `POST /opportunities/search` (deals)

Creating contacts or adding them to sequences changes the owner's live Apollo data. Confirm first.

## Rate limits

Limits are per endpoint and per plan (per minute, hour, and day). A 429 means wait; `POST /usage_stats/api_usage_stats` shows current limits.
