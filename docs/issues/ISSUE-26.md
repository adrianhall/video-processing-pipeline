# Example Issue

## Summary

When tearing down the infrastructure, the R2 bucket cannot be deleted unless it is empty.

## Relevant skills

- `cloudflare-scripts`
- `cloudflare`
- `wrangler`

## Dependencies

- ISSUE-02

## Acceptance Criteria

- [ ] I can run `npm run teardown` and it will prompt to empty the bucket.

## Technical Implementation

My initial thought is to have a scripts/empty-bucket.js script.  This uses dotenv (so it has access to the API token); as a result, it can query the REST API to determine the number of objects.  Relevant endpoints:

- <https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/get>
- <https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list>

The script can then prompt "X objects exist in this bucket.  Are you sure?" and wait for a response, before emptying the bucket with a recursive delete:

- <https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/delete>

Do not delete the bucket itself as this is done by Terraform.

## Manual Tests

- [ ] Put some objects in an R2 bucket and then run the script with appropriate arguments to determine functionality is correct.

## Other Notes

There may be methods beyond a defined script that we should definitely research - e.g. npx wrangler.  There may also be S3 compatible npm libraries that allow you to clear the contents.  Since we have the R2 access and secret keys when running, there ARE other options.

Reference: <https://blog.gravyware.com/s3-deleteobject-for-multiple-s3-objects#listing-out-the-s3-objects-to-be-deleted>
