import express, { Request, Response } from "express";
const router = express.Router();
const client = require("../config/database");
const redis = require("redis");
const { promisify } = require("util");
const { upload } = require("../config/multer");
import { generateid } from "../controller/generateid";
const fs = require("fs");
const unlinkAsync = promisify(fs.unlink);

const rclient = redis.createClient({
  host: "127.0.0.1",
  port: 6379,
});

const GET_ASYNC = promisify(rclient.get).bind(rclient);
const SET_ASYNC = promisify(rclient.set).bind(rclient);

router.post("/upload", async (req: Request, res: Response) => {
  await upload(req, res, async (error: any) => {
    try {
      const {
        post_title,
        post_meta_title,
        post_slug,
        post_summary,
        post_content,
        post_published,
        author_id,
        category_id,
      } = req.body;
      const id = generateid();
      const img = req.file?.filename;
      client.query("BEGIN");
      const now = new Date();
      const query =
        "INSERT INTO post (post_id,title,meta_title,slug,summary,content,published,publishedAt,author_id,image)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING post_id";

      const values = [
        id,
        post_title,
        post_meta_title,
        post_slug,
        post_summary,
        post_content,
        post_published,
        now,
        author_id,
        img,
      ];
      const newpost = await client.query(query, values);

      const newcat = await client.query(
        "INSERT INTO post_category(post_id,category_id)VALUES($1,$2)",
        [newpost.rows[0].post_id, category_id]
      );
      client.query("COMMIT");
      res.json(newpost.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      if (req.file == undefined) {
        return res
          .status(400)
          .send({ message: "Please upload a .png/.jpg/.jpeg file below 5mb" });
      } else {
        unlinkAsync(req.file?.path);
      }
      res.status(400);
      res.json({
        err: err,
        error: error,
      });
    }
  });
});


//Get all Post
router.get("/posts", async (req: Request, res: Response) => {
  try {
    const reply = await GET_ASYNC('posts');
    if (reply) {
      console.log("using cached data");
      res.send(JSON.parse(reply));
      return;
    }
    await client.query("BEGIN");
    const query = "SELECT * FROM post ORDER BY post_id";
    const allPosts = await client.query(query);
    await client.query("COMMIT");
    const saveResult = await SET_ASYNC('posts', JSON.stringify(allPosts.rows), "EX", 50000);
    res.json(allPosts.rows);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400);
    res.json(err);
  }
});

//Get post by ID
router.get("/post/:id", async (req: Request, res: Response) => {
  try {
    const reply = await GET_ASYNC(req.params.id);
    if (reply) {
      console.log("using cached data");
      res.send(JSON.parse(reply));
      return;
    }
    await client.query("BEGIN");
    const id = req.params.id;
    const query =
      "SELECT po.post_id,po.title,po.meta_title,po.summary,po.slug,po.content,po.published,po.publishedat,po.image AS coverimg,ar.username AS author,cat.title AS category FROM post po JOIN authors ar ON po.author_id = ar.id JOIN post_category pc ON pc.post_id = po.post_id JOIN category cat ON cat.id = pc.category_id WHERE po.post_id = $1";
    const post = await client.query(query, [id]);
    await client.query("COMMIT");
    const saveResult = await SET_ASYNC(id, JSON.stringify(post.rows), "EX", 50000);
    res.json(post.rows);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400);
    res.json(err);
  }
});

//GET POSTS IN A CATEGORY CATEGORY_TITLE)
router.get("/posts/category/:category", async (req: Request, res: Response) => {
  try {
    await client.query("BEGIN");
    const { category } = req.params;
    const allPost = await client.query(
      "SELECT * FROM post JOIN authors ON post.author_id = authors.id JOIN post_category ON post_category.post_id = post.post_id JOIN category ON category.id = post_category.category_id WHERE category.title = $1",
      [category]
    );
    await client.query("COMMIT");
    res.json(allPost.rows);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400);
    res.json(err);
  }
});

//Get post by author (ID)
router.get("/posts/author/:author", async (req: Request, res: Response) => {
  try {
    await client.query("BEGIN");
    const { author } = req.params;
    const query =
      "SELECT * FROM post JOIN authors ON post.author_id = authors.id JOIN post_category ON post_category.post_id = post.post_id JOIN category ON category.id = post_category.category_id WHERE authors.username = $1";
    const filterPost = await client.query(query, [author]);
    await client.query("COMMIT");
    res.json(filterPost.rows);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400);
    res.json(err);
  }
});

router.put("/post/:id", async (req: Request, res: Response) => {
  await upload(req, res, async (error: any) => {
    try {
      await client.query("BEGIN");
      const id = req.params.id;
      const {
        post_title,
        post_meta_title,
        post_slug,
        post_summary,
        post_content,
        post_published,
        author_id,
        category_id,
      } = req.body;

      const initialimg = await client.query(
        "SELECT image FROM post WHERE post_id = $1",
        [id]
      );

      //get current img name
      const imgdel = initialimg.rows?.[0].image;

      const img = req.file?.filename;

      const query =
        "UPDATE post SET title = $1,meta_title = $2,slug = $3,summary = $4,content = $5,published = $6,author_id = $7,image = $8 WHERE post_id = $9";

      const updatepost = await client.query(query, [
        post_title,
        post_meta_title,
        post_slug,
        post_summary,
        post_content,
        post_published,
        author_id,
        img,
        id,
      ]);

      const category =
        "UPDATE post_category SET category_id = $1 WHERE post_id = $2";
      const updatcategory = await client.query(category, [category_id, id]);

      await client.query("COMMIT");
      const currentimg = await client.query(
        "SELECT image FROM post WHERE post_id = $1",
        [id]
      );
      res.json("post updated");
      if (initialimg === currentimg) {
        res.json("img is same");
      } else {
        unlinkAsync("images/post_banner/" + imgdel);
      }
    } catch (err) {
      await client.query("ROLLBACK");
      await unlinkAsync(req.file?.path);
      res.status(400);
      res.json({
        err: err,
        error: error,
      });
    }
  });
});

router.delete("/post/:id", async (req: Request, res: Response) => {
  try {
    await client.query("BEGIN");
    const { id } = req.params;
    const imgquery = await client.query(
      "SELECT image FROM post WHERE post_id = $1",
      [id]
    );
    const img = imgquery.rows?.[0].image;
    const query = "DELETE FROM post WHERE post_id = $1";
    const deletePost = await client.query(query, [id]);
    await client.query("COMMIT");
    await unlinkAsync("images/post_banner/" + img);
    res.json("post deleted");
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(400);
    res.json(err);
  }
});

module.exports = router;


module.exports = router;
