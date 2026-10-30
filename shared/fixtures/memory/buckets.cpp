#include <iostream>
struct Node {
    int value;
    Node* next;
};
Node* insert(Node* head, int value) {
    if (head == nullptr || value < head->value) {
        Node* node = new Node{};
        node->value = value;
        node->next = head;
        return node;
    }
    head->next = insert(head->next, value);
    return head;
}
int main() {
    Node* buckets[3] = {};
    int n;
    std::cin >> n;
    for (int i = 0; i < n; i = i + 1) {
        int value;
        std::cin >> value;
        int bucket = value / 3;
        buckets[bucket] = insert(buckets[bucket], value);
    }
    for (int i = 0; i < 3; i = i + 1) {
        Node* p = buckets[i];
        while (p != nullptr) {
            std::cout << p->value << " ";
            Node* next = p->next;
            delete p;
            p = next;
        }
    }
    std::cout << "\n";
    return 0;
}
