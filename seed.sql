-- Auto-generated seeding script for BelBurger POS
BEGIN;

-- Clean existing menu data
TRUNCATE TABLE modifiers, order_items, products, categories CASCADE;

-- Create default seeding store
INSERT INTO stores (id, name, business_type) 
VALUES ('c0c53dda-4706-455a-ad5b-5f3f9164cf00', 'BelBurger Staging Store', 'restaurant')
ON CONFLICT (id) DO NOTHING;

-- 1. Insert Categories
INSERT INTO categories (id, name, store_id) VALUES ('d1453dda-4706-455a-ad5b-5f3f9164cf10', 'Tacos', 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO categories (id, name, store_id) VALUES ('359c9501-3439-402c-a59f-f433accd3593', 'Side', 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO categories (id, name, store_id) VALUES ('f15ec9da-5f15-4734-a187-bd809ba6397d', 'Family Meals', 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO categories (id, name, store_id) VALUES ('dbad2d7b-9957-404f-8ad6-ee76c076ee65', 'Vegetarian Burgers', 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO categories (id, name, store_id) VALUES ('7e27e3b2-2975-40c3-8047-70857973d1b4', 'Pasta', 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO categories (id, name, store_id) VALUES ('f28c4aa3-d402-4e53-8f37-2973ed23041a', 'Kids Menu', 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO categories (id, name, store_id) VALUES ('5e64c5b5-4247-4760-8ce0-738890ae0fbc', 'Fries', 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO categories (id, name, store_id) VALUES ('249de105-a02a-43be-b7fe-d06f75c5345d', 'Dranken', 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO categories (id, name, store_id) VALUES ('98274b9b-c7a1-4bf5-9eb6-88e6a26a744f', 'Extras', 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO categories (id, name, store_id) VALUES ('1e3746e8-52f6-426d-8d31-40be9a3f121c', 'Beef Burgers Menu', 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO categories (id, name, store_id) VALUES ('387527a2-6875-4ea5-b1a5-c60086780872', 'Beef Burgers', 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO categories (id, name, store_id) VALUES ('c258d61d-90cf-4dc0-b603-cbf6693706d1', 'Chicken Burgers Menu', 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO categories (id, name, store_id) VALUES ('b548e503-7570-4687-b9e9-fb2a20efcd3e', 'Chicken Burgers', 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');

-- 2. Insert Products
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('404f11b5-ea79-4359-9272-7f5e2e77c4c2', 'd1453dda-4706-455a-ad5b-5f3f9164cf10', 'Bel Beef Tacos Menu', 15.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('7dc32ad2-ab9a-4453-8744-f0229e344fe2', '359c9501-3439-402c-a59f-f433accd3593', 'Bel Grilled Wings (8 stuks)', 9.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('3dd072f6-42f8-4f30-900b-1b1b154ec4c0', 'd1453dda-4706-455a-ad5b-5f3f9164cf10', 'Bel Chicken Tacos Menu', 15.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('7bbdbd57-39c3-4c49-9930-8c8aef588326', 'f15ec9da-5f15-4734-a187-bd809ba6397d', '10 Nuggets', 7.9, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('dfa320ad-b820-4df3-b13d-32e352cf8dce', '359c9501-3439-402c-a59f-f433accd3593', 'Uienringen (10 stuks)', 5.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('342232ec-b2ea-45b9-89d3-acc23d3b4571', '359c9501-3439-402c-a59f-f433accd3593', 'Kip Wings (6 stuks) + Saus', 9.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('e1717891-99db-4f40-beb7-7e693974ba17', 'd1453dda-4706-455a-ad5b-5f3f9164cf10', 'Bel Chicken Tacos', 9.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('1494539a-0762-4963-88e1-8c69b685c7d9', 'f15ec9da-5f15-4734-a187-bd809ba6397d', 'Crunchy Box', 38.78, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('8c1aeff6-db55-474f-9bee-9737f192ef45', '359c9501-3439-402c-a59f-f433accd3593', 'Kip Tenders (5 stuks) + Saus', 9.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('b1e95247-7e7c-48d1-9026-c6426e2e9994', 'd1453dda-4706-455a-ad5b-5f3f9164cf10', 'Bel Beef Tacos', 9.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('b233a8e6-6685-4c1b-a4cf-2cade4976061', '359c9501-3439-402c-a59f-f433accd3593', 'Mix Box – 3 tenders + 3 wings + 3 sauzen', 9.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('d7f1526a-6ff1-407a-8f8c-b6576e68014c', 'dbad2d7b-9957-404f-8ad6-ee76c076ee65', 'Veggie Bel Burger Menu', 15.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('335905c3-1f94-4d4c-aa5f-102debd1b65b', 'dbad2d7b-9957-404f-8ad6-ee76c076ee65', 'Veggie Bel Burger', 9.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('46a718f0-529a-4ec5-8b66-6b234e1a66c9', '7e27e3b2-2975-40c3-8047-70857973d1b4', 'Bel Farfalle Bolognese', 12.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('e31004bf-463c-4b8d-af09-a9b3b870b49f', '7e27e3b2-2975-40c3-8047-70857973d1b4', 'Bel Farfalle Creamy Chicken', 11.4, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('52a7ff62-549a-4797-8651-a6cc94afb5dc', '7e27e3b2-2975-40c3-8047-70857973d1b4', 'Bel Farfalle Shrimp White Sauce', 14.4, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('733034c9-67b7-4c70-b0de-43c60ac41cc4', 'f15ec9da-5f15-4734-a187-bd809ba6397d', 'Family Burger Feast', 47.94, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('c50b8c55-98ef-41a5-acff-5b74568a5d06', 'f15ec9da-5f15-4734-a187-bd809ba6397d', 'Wings & Tenders Box', 40.68, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('8d49c3f2-3b64-4988-a145-2f7fc1802708', 'f15ec9da-5f15-4734-a187-bd809ba6397d', 'Tacos Family Box', 55.14, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('23aa9429-3fbb-4e19-bc93-bb6cfe8c768a', 'f15ec9da-5f15-4734-a187-bd809ba6397d', 'Bel Mega Box', 55.08, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('d5f539ff-c0c9-4197-a977-22d861d1a3d2', 'f15ec9da-5f15-4734-a187-bd809ba6397d', 'Wings & Nuggets Family Box', 31.08, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('aaa6cb34-77e5-4ae7-a91c-ecf42f3ba84d', 'f28c4aa3-d402-4e53-8f37-2973ed23041a', 'Kinder Burger Menu', 16.8, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('fe9b5e1d-6c25-4894-96e3-b26a5b95378a', '5e64c5b5-4247-4760-8ce0-738890ae0fbc', 'Bel Classic Fries', 5.94, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('9e17ca91-7f81-4667-b600-eaa127f7a223', '5e64c5b5-4247-4760-8ce0-738890ae0fbc', 'Bel Special Fries', 10.74, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('6891e81e-9912-402c-b9cb-5aacff4965f9', '5e64c5b5-4247-4760-8ce0-738890ae0fbc', 'Gegrilde Groenten Friet', 10.74, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('14a5aaad-2745-4f25-be76-a8d832dd8569', '5e64c5b5-4247-4760-8ce0-738890ae0fbc', 'Bel Combo Fries Grote Portie', 18.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('31881e52-ff09-46b1-90ef-1f2506d1fad0', '249de105-a02a-43be-b7fe-d06f75c5345d', 'Chaudfontaine Plat', 3.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('45fa2459-a597-4090-adff-d020290974c3', '249de105-a02a-43be-b7fe-d06f75c5345d', 'V Cola Regular', 3.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('62737302-d98b-4e43-8a77-adae426657ae', '249de105-a02a-43be-b7fe-d06f75c5345d', 'Sariyer Cola 33cl', 3.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('8124289a-902e-4338-b9f7-71d2f68a41d4', '249de105-a02a-43be-b7fe-d06f75c5345d', 'Palestine Cola', 3.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('e4a33741-da5c-40a3-a629-ca3a6797b659', '249de105-a02a-43be-b7fe-d06f75c5345d', 'Capri-Sun Orange 0.2L', 3.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('65d25102-167f-43f1-abe0-d27efb3142a5', '249de105-a02a-43be-b7fe-d06f75c5345d', 'Sariyer Orange 33cl', 3.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('fdd4afaf-7b0c-4957-aa5e-8041648dfff1', '98274b9b-c7a1-4bf5-9eb6-88e6a26a744f', 'Extra plak Cheddar', 3.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('46d14522-628c-46af-88f7-f28ad7e1f7b5', '98274b9b-c7a1-4bf5-9eb6-88e6a26a744f', 'Extra kip', 4.8, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('5c523b2c-02bb-4fc2-ad79-421cf52d88b1', '98274b9b-c7a1-4bf5-9eb6-88e6a26a744f', 'Gekarameliseerde uien', 3.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('fe2a00dc-0450-4f5d-b925-ef8285ec581c', '98274b9b-c7a1-4bf5-9eb6-88e6a26a744f', 'Gebakken champignons in boter', 3.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('245f4f8d-7191-401f-b65a-8749812eb0be', '98274b9b-c7a1-4bf5-9eb6-88e6a26a744f', 'Extra rundvlees (120g)', 5.4, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('20707423-38d5-4742-b3a2-2096ec06afb3', '98274b9b-c7a1-4bf5-9eb6-88e6a26a744f', 'Extra augurken', 1.8, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('2e5ae276-0689-4bd8-a315-3f0c184af6b9', '1e3746e8-52f6-426d-8d31-40be9a3f121c', 'Classic Bel Burger Menu', 14.4, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('5b5ec329-3e99-41a0-ac7c-b45d712ade77', '1e3746e8-52f6-426d-8d31-40be9a3f121c', 'Smoky Bel Burger Menu', 15.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('46de71bb-b40c-4ced-9a93-97209845759c', '1e3746e8-52f6-426d-8d31-40be9a3f121c', 'Bel Mushroom Burger Menu', 15.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('39e5960e-00da-4696-a74a-5a8fd6c890b7', '1e3746e8-52f6-426d-8d31-40be9a3f121c', 'Bel Bacon BBQ Burger Menu', 15.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('d7e1ded0-eb54-4ea1-bbcc-4509b1cafa25', '1e3746e8-52f6-426d-8d31-40be9a3f121c', 'Bel Cheddar Double Burger Menu', 17.4, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('f12a990f-022a-44df-915e-b7e139ff8558', '1e3746e8-52f6-426d-8d31-40be9a3f121c', 'Bel Texas Burger Menu', 15.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('db032bc5-2a54-47cf-8c85-db065241ed82', '1e3746e8-52f6-426d-8d31-40be9a3f121c', 'Big Bel Burger Menu', 17.4, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('5e8c50f3-9585-4b8a-bdce-5a9ea8ec7af4', '387527a2-6875-4ea5-b1a5-c60086780872', 'Classic Bel Burger', 9.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('95ee08e2-97cf-4920-8907-086bc1e5e3cf', '387527a2-6875-4ea5-b1a5-c60086780872', 'Bel Mushroom Burger', 9.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('7c5ff630-ef93-445a-813b-bb161ab9e369', '387527a2-6875-4ea5-b1a5-c60086780872', 'Bel Bacon BBQ Burger', 9.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('b768df04-9cb6-47ef-ac33-c432625d0782', '387527a2-6875-4ea5-b1a5-c60086780872', 'Bel Cheddar Double Burger', 12.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('162e2256-5fb1-4e28-9bc0-8a20de65fd80', '387527a2-6875-4ea5-b1a5-c60086780872', 'Bel Texas Burger', 9.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('18c5e832-48b3-41b7-9d1e-2a5e6f79ed26', '387527a2-6875-4ea5-b1a5-c60086780872', 'Smoky Bel Burger', 9.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('e71f8a7f-c13e-421c-a8e7-66787d6d618e', '387527a2-6875-4ea5-b1a5-c60086780872', 'Big Bel Burger', 12.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('db3106aa-4ee1-40ee-b7c8-627409529d53', 'c258d61d-90cf-4dc0-b603-cbf6693706d1', 'Crispy Chicken Bel Menu', 15.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('7bdde1a6-1090-453d-94eb-34426bc63b2e', 'c258d61d-90cf-4dc0-b603-cbf6693706d1', 'Spicy Chicken Bel Menu', 15.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('78052957-2c3b-4ca2-ae75-ad8f6f35563e', 'c258d61d-90cf-4dc0-b603-cbf6693706d1', 'BBQ Chicken Bel Menu', 15.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('d9194685-83fa-4465-a31c-d8c9172b25ef', 'c258d61d-90cf-4dc0-b603-cbf6693706d1', 'Bel Honey Mustard Chicken Burger Menu', 15.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('5d70e8a6-9ee7-43e0-b7f9-daccd96590d0', 'c258d61d-90cf-4dc0-b603-cbf6693706d1', 'Bel Sweet & Spicy Chicken Burger Menu', 15.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('d4492735-4f5d-4693-952a-8c3d9a077364', 'c258d61d-90cf-4dc0-b603-cbf6693706d1', 'Bel Peri-Peri Chicken Burger Menu', 15.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('dc9eb884-d9ac-4bbd-badd-fd0157acd467', 'c258d61d-90cf-4dc0-b603-cbf6693706d1', 'Bel Jalapeno Chicken Menu', 15.0, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('d56545f0-59fb-46e9-ae05-43c4256988a1', 'b548e503-7570-4687-b9e9-fb2a20efcd3e', 'Crispy Chicken Bel', 9.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('5f8f6992-c210-4c93-a341-12f9ff285170', 'b548e503-7570-4687-b9e9-fb2a20efcd3e', 'Spicy Chicken Bel', 9.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('6876be8b-53e9-4b1e-a461-12043722bf82', 'b548e503-7570-4687-b9e9-fb2a20efcd3e', 'BBQ Chicken Bel', 9.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('11e168d6-025c-4eed-ac7d-22a3df64b310', 'b548e503-7570-4687-b9e9-fb2a20efcd3e', 'Bel Honey Mustard Chicken Burger', 9.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('d2c56d38-1861-488f-82fd-8a29e83d09e2', 'b548e503-7570-4687-b9e9-fb2a20efcd3e', 'Bel Sweet & Spicy Chicken Burger', 9.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('8a11841f-0294-49d6-adaa-6e98a1694d8d', 'b548e503-7570-4687-b9e9-fb2a20efcd3e', 'Bel Peri-Peri Chicken Burger', 9.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');
INSERT INTO products (id, category_id, name, price, vat_rate, store_id) VALUES ('3f4aba8f-f9aa-409a-a8b2-154b00a25dfc', 'b548e503-7570-4687-b9e9-fb2a20efcd3e', 'Bel Jalapeno Chicken', 9.6, 12.0, 'c0c53dda-4706-455a-ad5b-5f3f9164cf00');

-- 3. Insert Modifiers
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('992b7803-cf5a-4698-a3aa-eae2e87da121', '404f11b5-ea79-4359-9272-7f5e2e77c4c2', 'Chaudfontaine Plat', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('17ca1f3d-8155-4c7c-bb68-b234320491eb', '404f11b5-ea79-4359-9272-7f5e2e77c4c2', 'V Cola Regular', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('fe67730c-4b85-4de9-ad93-09ceb71b7597', '404f11b5-ea79-4359-9272-7f5e2e77c4c2', 'Sariyer Cola 33cl', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('6754175d-223d-4b42-a9e5-ef5652ff2600', '404f11b5-ea79-4359-9272-7f5e2e77c4c2', 'Palestine Cola', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('f3d59304-d0c5-4362-afa7-6ba09e724a55', '404f11b5-ea79-4359-9272-7f5e2e77c4c2', 'Capri-Sun Orange 0.2L', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('cbacc406-4b01-450f-b2c4-bcec3222fe18', '404f11b5-ea79-4359-9272-7f5e2e77c4c2', 'Sariyer Orange 33cl', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('50c29949-fe4f-4b18-a8fb-72a05ac4e38a', '733034c9-67b7-4c70-b0de-43c60ac41cc4', 'Crispy Chicken Bel', 9.6);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('dc9497d9-a965-4acf-846e-d6ef70916373', '733034c9-67b7-4c70-b0de-43c60ac41cc4', 'Spicy Chicken Bel', 9.6);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('3ea42e2d-61d1-4b54-8e67-e5e11344b972', '733034c9-67b7-4c70-b0de-43c60ac41cc4', 'BBQ Chicken Bel', 9.6);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('92d04c17-87fd-4fa4-b4ba-306ad62c8a53', '733034c9-67b7-4c70-b0de-43c60ac41cc4', 'Bel Honey Mustard Chicken Burger', 9.6);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('925a0017-7c64-461b-a027-bea7100a3813', '733034c9-67b7-4c70-b0de-43c60ac41cc4', 'Bel Sweet & Spicy Chicken Burger', 9.6);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('fe7ec88b-867b-45dc-90e5-490d11c92e5d', '733034c9-67b7-4c70-b0de-43c60ac41cc4', 'Bel Peri-Peri Chicken Burger', 9.6);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('68c747c1-8baf-41dd-ac8b-023647d90069', '733034c9-67b7-4c70-b0de-43c60ac41cc4', 'Bel Jalapeno Chicken', 9.6);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('5bce5553-05f6-498b-afc2-108b8365b866', '733034c9-67b7-4c70-b0de-43c60ac41cc4', 'Chaudfontaine Plat', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('993516fc-97c3-4dcf-b6c4-bc3611ce0598', '733034c9-67b7-4c70-b0de-43c60ac41cc4', 'V Cola Regular', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('aadee134-e733-423e-a8b4-3b6ee32d7800', '733034c9-67b7-4c70-b0de-43c60ac41cc4', 'Sariyer Cola 33cl', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('29a327c1-ab64-4e3b-abc0-f3cdc10ac984', '733034c9-67b7-4c70-b0de-43c60ac41cc4', 'Palestine Cola', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('e43552d0-ca2d-431c-87d6-2381811c6926', '733034c9-67b7-4c70-b0de-43c60ac41cc4', 'Capri-Sun Orange 0.2L', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('ef5a2622-7e10-4b09-9bf8-e4946eec59fb', '733034c9-67b7-4c70-b0de-43c60ac41cc4', 'Sariyer Orange 33cl', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('075fc973-922f-4a67-8196-a165a54c599c', 'db3106aa-4ee1-40ee-b7c8-627409529d53', 'Chaudfontaine Plat', 5.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('2343f0c9-e17e-49cb-9d51-5eb7f7cbd379', 'db3106aa-4ee1-40ee-b7c8-627409529d53', 'V Cola Regular', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('06dbdf1d-5066-4f25-90f4-0ad8cf87b25f', 'db3106aa-4ee1-40ee-b7c8-627409529d53', 'Sariyer Cola 33cl', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('7892187e-1d47-45ba-8855-03b9884ddcad', 'db3106aa-4ee1-40ee-b7c8-627409529d53', 'Palestine Cola', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('6e9a84c3-4bde-4f3c-aeff-5c1b8e297fcd', 'db3106aa-4ee1-40ee-b7c8-627409529d53', 'Capri-Sun Orange 0.2L', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('23745e1d-7746-489b-9dc1-92651525b6b5', 'db3106aa-4ee1-40ee-b7c8-627409529d53', 'Sariyer Orange 33cl', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('eaf9b286-1fc5-4560-8eb6-a8028b054fab', '7bdde1a6-1090-453d-94eb-34426bc63b2e', 'Chaudfontaine Plat', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('ee25fc6a-c0cb-4396-972a-988e0c7b8e41', '7bdde1a6-1090-453d-94eb-34426bc63b2e', 'V Cola Regular', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('3e4055fc-9622-4b4e-ac95-a0e0d37b26c8', '7bdde1a6-1090-453d-94eb-34426bc63b2e', 'Sariyer Cola 33cl', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('65965808-be5a-4ffc-8adc-820d93fcd41e', '7bdde1a6-1090-453d-94eb-34426bc63b2e', 'Palestine Cola', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('54963417-03a6-47b2-b0b3-a95c01928f97', '7bdde1a6-1090-453d-94eb-34426bc63b2e', 'Capri-Sun Orange 0.2L', 3.0);
INSERT INTO modifiers (id, product_id, name, price_adjustment) VALUES ('2212f9fe-4b06-473e-91f1-e0f50cc868e8', '7bdde1a6-1090-453d-94eb-34426bc63b2e', 'Sariyer Orange 33cl', 3.0);

COMMIT;
