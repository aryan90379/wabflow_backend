import { ListGroup } from "../models/ListGroup.js";
import { ListItem } from "../models/ListItem.js";

export const getLists = async (req, res) => {
  try {
    const businessId = req.business.id;
    const lists = await ListGroup.find({ businessId, active: true }).sort({ createdAt: -1 });
    const items = await ListItem.find({ businessId, active: true }).sort({ createdAt: -1 });
    
    // Group items by listGroupId
    const listsWithItems = lists.map(list => {
      const listObj = list.toObject();
      listObj.items = items.filter(item => String(item.listGroupId) === String(list._id));
      return listObj;
    });

    res.status(200).json(listsWithItems);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch lists", error: error.message });
  }
};

export const createList = async (req, res) => {
  try {
    const businessId = req.business.id;
    const { name, description } = req.body;

    const newList = new ListGroup({
      businessId,
      name: name || 'Untitled List',
      description,
    });

    await newList.save();
    
    const listObj = newList.toObject();
    listObj.items = [];
    
    res.status(201).json(listObj);
  } catch (error) {
    res.status(500).json({ message: "Failed to create list", error: error.message });
  }
};

export const updateList = async (req, res) => {
  try {
    const businessId = req.business.id;
    const { id } = req.params;
    const { name, description } = req.body;

    const list = await ListGroup.findOneAndUpdate(
      { _id: id, businessId },
      { name, description },
      { new: true }
    );

    if (!list) {
      return res.status(404).json({ message: "List not found" });
    }

    res.status(200).json(list);
  } catch (error) {
    res.status(500).json({ message: "Failed to update list", error: error.message });
  }
};

export const deleteList = async (req, res) => {
  try {
    const businessId = req.business.id;
    const { id } = req.params;

    // Soft delete list
    await ListGroup.findOneAndUpdate({ _id: id, businessId }, { active: false });
    // Soft delete associated items
    await ListItem.updateMany({ listGroupId: id, businessId }, { active: false });

    res.status(200).json({ message: "List deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete list", error: error.message });
  }
};

export const createListItem = async (req, res) => {
  try {
    const businessId = req.business.id;
    const { id } = req.params; // listGroupId
    const { title, details, price, currency, imageUrl } = req.body;

    const list = await ListGroup.findOne({ _id: id, businessId, active: true });
    if (!list) {
      return res.status(404).json({ message: "List not found" });
    }

    const newItem = new ListItem({
      listGroupId: id,
      businessId,
      title,
      details,
      price,
      currency,
      imageUrl,
    });

    await newItem.save();
    res.status(201).json(newItem);
  } catch (error) {
    res.status(500).json({ message: "Failed to create item", error: error.message });
  }
};

export const updateListItem = async (req, res) => {
  try {
    const businessId = req.business.id;
    const { itemId } = req.params;
    const { title, details, price, currency, imageUrl } = req.body;

    const item = await ListItem.findOneAndUpdate(
      { _id: itemId, businessId },
      { title, details, price, currency, imageUrl },
      { new: true }
    );

    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    res.status(200).json(item);
  } catch (error) {
    res.status(500).json({ message: "Failed to update item", error: error.message });
  }
};

export const deleteListItem = async (req, res) => {
  try {
    const businessId = req.business.id;
    const { itemId } = req.params;

    await ListItem.findOneAndUpdate({ _id: itemId, businessId }, { active: false });

    res.status(200).json({ message: "Item deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete item", error: error.message });
  }
};
