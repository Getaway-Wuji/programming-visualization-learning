#include <iostream>
// @phase types
struct Node {
    int value;
    Node* left;
    Node* right;
};
// @phase find
int contains(Node* root, int value) {
    Node* current = root;
    while (current != nullptr) {
        if (value == current->value) { return 1; }
        if (value < current->value) { current = current->left; }
        else { current = current->right; }
    }
    return 0;
}
// @phase allocate
Node* insert(Node* root, int value) {
    if (root == nullptr) {
        Node* node = new Node{};
        node->value = value;
        return node;
    }
    // @phase link
    if (value < root->value) { root->left = insert(root->left, value); }
    else { root->right = insert(root->right, value); }
    return root;
}
// @phase preorder
void preorder(Node* node) {
    if (node == nullptr) { return; }
    std::cout << " " << node->value;
    preorder(node->left);
    preorder(node->right);
}
// @phase inorder
void inorder(Node* node) {
    if (node == nullptr) { return; }
    inorder(node->left);
    std::cout << " " << node->value;
    inorder(node->right);
}
// @phase postorder
void postorder(Node* node) {
    if (node == nullptr) { return; }
    postorder(node->left);
    postorder(node->right);
    std::cout << " " << node->value;
}
// @phase release
void destroy(Node* node) {
    if (node == nullptr) { return; }
    destroy(node->left);
    destroy(node->right);
    delete node;
}
// @phase setup
int main() {
    int encodedLength = {{n}};
    Node* root = nullptr;
    int size = 0;
    int consumed = 0;
    int processed = 0;
    int outcome = 0;
    // @phase read
    while (consumed < encodedLength) {
        outcome = 0;
        int command;
        std::cin >> command;
        consumed = consumed + 1;
        // @phase insert
        if (command == 1) {
            int value;
            std::cin >> value;
            consumed = consumed + 1;
            if (contains(root, value) == 1) {
                outcome = 6;
                std::cout << "DUP " << value << "\n";
            } else if (size == 7) {
                outcome = 4;
                std::cout << "FULL " << value << "\n";
            } else {
                root = insert(root, value);
                size = size + 1;
                outcome = 1;
                std::cout << "INSERT " << value << "\n";
            }
        // @phase search
        } else if (command == 2) {
            int value;
            std::cin >> value;
            consumed = consumed + 1;
            if (contains(root, value) == 1) {
                outcome = 7;
                std::cout << "FOUND " << value << "\n";
            } else {
                outcome = 8;
                std::cout << "MISS " << value << "\n";
            }
        // @phase visit
        } else if (command == 3) {
            std::cout << "PRE";
            preorder(root);
            std::cout << "\n";
            outcome = 3;
        } else if (command == 4) {
            std::cout << "IN";
            inorder(root);
            std::cout << "\n";
            outcome = 3;
        } else if (command == 5) {
            std::cout << "POST";
            postorder(root);
            std::cout << "\n";
            outcome = 3;
        // @phase invalid
        } else {
            outcome = 9;
            std::cout << "INVALID " << command << "\n";
            return 1;
        }
        // @phase advance
        processed = processed + 1;
    }
    // @phase cleanup
    destroy(root);
    root = nullptr;
    size = 0;
    // @phase finish
    std::cout << "END\n";
    return 0;
}
