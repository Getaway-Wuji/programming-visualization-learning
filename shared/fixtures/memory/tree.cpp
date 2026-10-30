#include <iostream>
struct Node {
    int value;
    Node* left;
    Node* right;
};
Node* insert(Node* root, int value) {
    if (root == nullptr) {
        Node* node = new Node{};
        node->value = value;
        return node;
    }
    if (value < root->value) {
        root->left = insert(root->left, value);
    } else {
        root->right = insert(root->right, value);
    }
    return root;
}
void print(Node* root) {
    if (root == nullptr) { return; }
    print(root->left);
    std::cout << root->value << " ";
    print(root->right);
}
void destroy(Node* root) {
    if (root == nullptr) { return; }
    destroy(root->left);
    destroy(root->right);
    delete root;
}
int main() {
    int n;
    std::cin >> n;
    Node* root = nullptr;
    for (int i = 0; i < n; i = i + 1) {
        int value;
        std::cin >> value;
        root = insert(root, value);
    }
    print(root);
    std::cout << "\n";
    destroy(root);
    return 0;
}
