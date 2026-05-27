# Video Processing Architecture

(This is a transcript to a conversation with an AI about an initial idea)

> I’m thinking of developing a video streaming product using the cloudflare dev platform; I’m thinking a web site (worker with static assets) allows you to drag and drop videos onto it - these are stored in “incoming” in R2, and a queue entry + a D1 database entry are created; The website can see the list of videos being processed. On the processing side, I use a durable object. The worker reads from the queue and submits to the durable object, which spins up a container (if it isn’t running). The container does whatever operation (re-encoding, thumbnails, etc.) before storing in R2 under “not incoming”. Once complete, the durable object will update the status of the D1 database entry and remove the R2 incoming file (or move it). The video can then be submitted via API to stream. I’m also thinking this may be more appropriate as a multi-step restartable process as a workflow - what’s the best architecture for this?

Your proposed architecture is solid, but given that it’s 2026, Cloudflare Workflows is now the superior choice for this specific use case. While Durable Objects (DO) are great for stateful coordination, Workflows are purpose-built for the "multi-step, restartable" logic you're looking for.  
Reddit

Here is the recommended architecture using the modern Cloudflare stack:

## 1. The Frontend & Ingest (Workers + R2)

* **Upload**: Your worker handles the drag-and-drop upload.  Using **R2 Pre-signed URLs** is more efficient than streaming bytes through the worker; the browser uploads directly to the `incoming/` prefix in R2.

* **Trigger**: Once the upload is successful, the worker initiates a [**Workflow instance**](https://developers.cloudflare.com/dynamic-workers/usage/dynamic-workflows/#:~:text=The%20Worker%20Loader%20receives%20a,saved%20with%20the%20instance%20automatically).

```typescript
// Example: Triggering the workflow
const instance = await env.VIDEO_WORKFLOW.create({
    params: { videoId: "123", r2Path: "incoming/123.mp4" }
});
```

## 2. The Orchestration (Cloudflare Workflows)

Replace your "Queue + DO" logic with a single Workflow class.  Workflows automatically handle retries and state persistence between steps, meaning you don't need to manually update D1 just to track progress.

* **Step 1: Register (D1)**: Create the entry in D1 with a `processing` status.
* **Step 2: Process (Containers)**: Call your processing logic.  If you are using Cloudflare Workers, Workers for Platforms, or Cloudflare Containers, the workflow waits for the result.
* **Step 3: Storage (R2)**: Move the file from `incoming/` to `final/`.
* **Step 4: Finalize (D1)**: Update the status to `ready`.

## 3. The Processing Side (Cloudflare Containers vs. Workers)

Since re-encoding is CPU-intensive, a standard Worker might hit CPU limits (30s on paid plans).  

* **Cloudflare Containers**: You can now spin up OCI-compliant containers directly from your workflow.  This is ideal for running `ffmpeg`.
* **Workflows Integration**: Use `step.do()` to trigger the container.  If the container fails, the workflow will retry just that specific step without restarting the entire process.

## Why Workflows over Durable Objects?

| Feature | Durable Objects (DO) | Cloudflare Workflows (Recommended) |
|-|-|-|
| State | Managed manually via `this.storage`. | Automatic "memoization" of step results. |
| Retries | You must write custom logic to handle crashes. | Native `retries` policy per step. |
| Long-Running | Good for "active" state (WebSockets). | Optimized for "passive" state (wait for hours). |
| Complexity | High (Requires Queues + Alarms + D1). | Low (Linear `async/await` code). |

## Recommended Refined Architecture

1. R2: Storage for raw and processed assets.
2. D1: Metadata and final video library index.
3. Workflows: The "glue" that moves the video through its lifecycle.
4. Cloudflare Stream API: Instead of building your own streaming delivery, move the processed file from R2 to Cloudflare Stream via their API at the end of your workflow.  This gives you the best-in-class player and adaptive bitrate (ABR) delivery without managing HLS/DASH segments yourself.

**Pro Tip**: In 2026, you can use **Dynamic Workflows** if you're building this for multiple tenants.  This allows you to deploy the worker loader once and swap out the transcoding logic per user if needed.

> I'm not using multi-tenancy. How would this get affected if you wanted to serialize the video processing - one container instance only?

If you want to ensure that only one container instance runs at a time—effectively creating a FIFO (First-In, First-Out) serial processor—the architecture shifts slightly. While Workflows handle the logic of a single video perfectly, they are inherently parallel. To force them into a single-file line, you need a Concurrency Controller.

In the Cloudflare ecosystem, the best way to enforce "Exactly One" processing is to re-introduce a Durable Object (DO) specifically as a Global Scheduler.

## The Serialized Architecture

1. The Ingest (Worker): The same as before—upload to R2. Instead of starting the Workflow directly, the Worker sends a message to your Scheduler Durable Object.
2. The Scheduler (Durable Object): This DO acts as your "Singleton" traffic cop.
    * It maintains a queue of `videoId`s in its own persistent storage.
    * It tracks a `isProcessing` boolean state.
3. The Logic: When a new video arrives, if `isProcessing` is false, it marks it true and triggers the Workflow (or Container). If true, it just adds the ID to the queue.
4. The Execution (Workflow/Container): The actual heavy lifting happens here.
5. The Completion Callback: When the processing is finished, the Workflow/Container makes a final call back to the Scheduler DO saying, "I'm done."
    * The DO then checks its queue. If there's another video waiting, it triggers the next one. If not, it sets `isProcessing` to false.

## Why this approach?

* Strict Serialization: Because Durable Objects are single-threaded and globally unique based on an ID (e.g., you name the DO "GlobalProcessor"), you are guaranteed that two videos won't be processed simultaneously.

* Cost Control: This is the most effective way to limit costs if you're using high-spec container instances, as you’ll never have a "burst" of expensive compute.

* Reliability: By using DO Alarms, you can build a "Watchdog" timer. If a container crashes and fails to send the "I'm done" signal, the DO Alarm will wake up after 10 minutes, check the state, and restart the queue automatically.

## D1 vs. Durable Object for the Queue

While you _could_ use D1 to manage the queue, a Durable Object is significantly faster for this type of coordination. D1 is eventually consistent across regions (unless using strict session affinity), whereas a DO is a single point of truth in a specific data center, which prevents "race conditions" where two videos accidentally start at once.

## Key Trade-offs to Consider

* Latency: If you have 10 users upload at once, the 10th user will have to wait for the previous 9 to finish. In a video context, this could mean hours of delay.

* Bottleneck: Your entire product's throughput is limited by the speed of a single container.

<!-- END OF TRANSCRIPT -->

## Idea (Refined)

Provide a video-processing pipeline for publishing videos.

* User drags-and-drops videos onto the platform.
* Uploads are queued (with the queue displayed on the web page)
* Once uploaded, workflow is kicked off (workflow state is tracked on the web page)
* Workflow does the following:
  * Identify if mp4 or something else (mkv, webm) - transcode if needed
  * [Extract audio to mp3 file using ffmpeg](https://stackoverflow.com/questions/9913032/how-can-i-extract-audio-from-video-with-ffmpeg) (store in audio/videoId.mp3)
  * [Grayscale video using ffmpeg](https://davidwalsh.name/convert-video-grayscale) (store in bwvideo/videoId.mp4)
  * Upload the grayscale video to Stream (store the URL)
* Once complete, the user should be able to click on the video to start the stream using the stream player.

Components:

* terraform for infra (use cloudflare-scripts npm pkg and skill) - wrangler for deploys
* Cloudflare Access for authn/authz (use cloudflare-auth npm pkg and skill)
* Workers, D1, R2, Workflows, Stream
* React for UI
* Hono for API

This will be "example code" for a blog article on Workflows, so focus must be on making the workflow simple enough to understand and well documented.
